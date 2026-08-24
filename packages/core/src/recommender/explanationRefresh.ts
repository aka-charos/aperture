/**
 * Re-run only the explanation pass over recommendations that already exist.
 *
 * The picks, the scores, the diversity selection and the evidence are all
 * already in `recommendation_candidates` and `recommendation_evidence`; the
 * explanation is a separate text-generation call layered on top, and it is the
 * only part of the pipeline that depends on which writing model is configured.
 * Before this, rewriting it meant regenerating everything — embedding
 * retrieval, scoring, twin affinity across every pair of viewers, the lot —
 * which is minutes of work and a different set of picks, to change a paragraph.
 *
 * Two things this is for. Repairing a run whose explanations fell back to the
 * template (a truncated response used to discard a whole batch; see
 * shared/explanationParsing.ts), and comparing writing models cheaply — point
 * the textGeneration role at something else, refresh one user, read the result.
 *
 * Deliberately targets the newest **completed** run per user per media type,
 * which is the run every reader resolves: /api/recommendations, both insights
 * routes and both STRM writers. Refreshing anything older would rewrite text
 * nobody will see, and would hit the caveat in buildRunSimilarityScale.
 */

import { randomUUID } from 'crypto'
import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getEffectiveAiExplanationSetting } from '../lib/userSettings.js'
import {
  buildSimilarityScale,
  normalizeSimilarity,
  type SimilarityScale,
} from './shared/scoring.js'
import {
  generateExplanations,
  storeExplanations,
  type MovieForExplanation,
} from './movies/explanations.js'
import {
  generateSeriesExplanations,
  storeSeriesExplanations,
  type SeriesForExplanation,
} from './series/explanations.js'
import {
  createJobProgress,
  updateJobProgress,
  setJobStep,
  addLog,
  completeJob,
  failJob,
  isJobCancelled,
} from '../jobs/progress.js'

const logger = createChildLogger('explanation-refresh')

export type ExplanationMediaType = 'movie' | 'series'

const ALL_MEDIA_TYPES: ExplanationMediaType[] = ['movie', 'series']

export interface ExplanationRefreshOptions {
  /** One user, or every enabled user holding a completed run when omitted. */
  userId?: string
  /** Defaults to both. */
  mediaTypes?: ExplanationMediaType[]
}

export interface ExplanationRefreshResult {
  /** Runs whose explanations were rewritten. */
  runs: number
  /** Individual explanations stored across those runs. */
  explanations: number
  /**
   * Runs left alone: no completed run, no picks on it, or the user has AI
   * explanations switched off. Not an error — the same gate the pipeline obeys.
   */
  skipped: number
  failed: number
  jobId: string
}

// ============================================================================
// Reading a stored run back into explanation inputs
// ============================================================================

/**
 * pg hands NUMERIC back as a string, so every score column needs converting
 * rather than casting: '0.0000' passes a truthy test while a real 0 fails one,
 * and that exact trap has already produced a "Variety 0%" on this data once.
 */
function numOrNull(value: string | number | null): number | null {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

interface StoredBreakdown {
  interestMatch?: { interestText?: unknown }
  twinMatch?: { sharedIds?: unknown }
  acclaimedMatch?: unknown
}

/**
 * Which reserved slot, if any, put this pick in the list.
 *
 * Both generators need this: an interest pick has to be explained by the
 * interest and a twin pick by the overlapping viewer, because for those two the
 * ranking is precisely what did *not* choose the title. score_breakdown is
 * where the pipeline recorded it, and a twin's donor id stays in the column —
 * only the flag and the shared titles travel onward, so no identity can reach a
 * prompt. Those shared ids are titles from the READER's own history, which is
 * what makes them safe to name and also what makes them the one honest reason
 * available for a borrowed pick.
 *
 * A run made before `sharedIds` was recorded yields an empty list, and the
 * prompt falls back to the bare anonymous line.
 */
function readSlotOrigin(breakdown: unknown): {
  interestText: string | null
  fromTasteTwin: boolean
  twinSharedIds: string[]
  fromAcclaimed: boolean
} {
  const parsed = (breakdown ?? {}) as StoredBreakdown
  const interestText = parsed.interestMatch?.interestText
  const sharedIds = parsed.twinMatch?.sharedIds
  return {
    interestText: typeof interestText === 'string' && interestText ? interestText : null,
    fromTasteTwin: parsed.twinMatch != null,
    twinSharedIds: Array.isArray(sharedIds)
      ? sharedIds.filter((id): id is string => typeof id === 'string')
      : [],
    fromAcclaimed: parsed.acclaimedMatch != null,
  }
}

/**
 * Rebuild the run's similarity scale from the scores it stored.
 *
 * Only needed for runs made before `normalized_similarity` was a column
 * (migration 0141). Those stored the raw cosine alone, so the pool-relative
 * value has to be derived again; feeding the same stored pool to
 * buildSimilarityScale reproduces it exactly.
 *
 * The caveat that made this fragile, and the reason callers here only ever
 * target the newest completed run: thinSupersededCandidates strips non-selected
 * rows from every *other* run, so an older one would yield a scale built from
 * its twenty picks alone — the top slice of the distribution, whose mean is
 * nothing like the pool's. Runs written since 0141 read the stored value and
 * are not exposed to that at all.
 */
async function buildRunSimilarityScale(runId: string): Promise<SimilarityScale> {
  const result = await query<{ similarity_score: string | null }>(
    `SELECT similarity_score FROM recommendation_candidates WHERE run_id = $1`,
    [runId]
  )

  const values: number[] = []
  for (const row of result.rows) {
    const value = numOrNull(row.similarity_score)
    if (value !== null) values.push(value)
  }

  return buildSimilarityScale(values)
}

interface StoredPickRow {
  title: string
  year: number | null
  genres: string[] | null
  overview: string | null
  similarity_score: string | null
  normalized_similarity: string | null
  novelty_score: string | null
  rating_score: string | null
  score_breakdown: unknown
}

/**
 * The pool-relative similarity the run actually scored with, preferring what it
 * stored over what can be inferred from what it stored.
 *
 * NULL means the run predates migration 0141, not that the value was zero — so
 * the fallback recomputes rather than defaulting, and a genuine 0 (possible:
 * normalizeSimilarity returns 0.5 for a degenerate pool, and tanh can land
 * anywhere) is respected.
 */
function resolveNormalizedSimilarity(
  stored: string | null,
  rawSimilarity: number,
  scale: SimilarityScale
): number {
  const value = numOrNull(stored)
  return value ?? normalizeSimilarity(rawSimilarity, scale)
}

/**
 * Ordered by the rank the reader sees, so the numbering in the prompt matches
 * the list on the page — which matters only for the log line, but costs
 * nothing. selected_rank can be null on runs made before it existed, hence the
 * fallback to the pool rank.
 */
const PICK_ORDER = `ORDER BY rc.selected_rank NULLS LAST, rc.rank`

async function refreshMovieRun(
  runId: string,
  userId: string,
  shouldCancel?: () => boolean
): Promise<number> {
  const scale = await buildRunSimilarityScale(runId)

  const result = await query<StoredPickRow & { movie_id: string }>(
    `SELECT rc.movie_id, rc.similarity_score, rc.normalized_similarity, rc.novelty_score,
            rc.rating_score, rc.score_breakdown, m.title, m.year, m.genres, m.overview
     FROM recommendation_candidates rc
     JOIN movies m ON m.id = rc.movie_id
     WHERE rc.run_id = $1 AND rc.is_selected = true
     ${PICK_ORDER}`,
    [runId]
  )

  if (result.rows.length === 0) return 0

  const movies: MovieForExplanation[] = result.rows.map((row) => {
    const similarity = numOrNull(row.similarity_score) ?? 0
    const origin = readSlotOrigin(row.score_breakdown)
    return {
      movieId: row.movie_id,
      title: row.title,
      year: row.year,
      genres: row.genres ?? [],
      overview: row.overview,
      similarity,
      normalizedSimilarity: resolveNormalizedSimilarity(
        row.normalized_similarity,
        similarity,
        scale
      ),
      novelty: numOrNull(row.novelty_score) ?? 0,
      ratingScore: numOrNull(row.rating_score) ?? 0,
      interestText: origin.interestText,
      fromTasteTwin: origin.fromTasteTwin,
      twinSharedIds: origin.twinSharedIds,
      fromAcclaimed: origin.fromAcclaimed,
    }
  })

  const explanations = await generateExplanations(runId, userId, movies, shouldCancel)
  // Stored even when the generation was cut short: a partial rewrite leaves the
  // remaining picks on their previous text, which is a strictly better state
  // than throwing away the explanations already paid for.
  await storeExplanations(runId, explanations)
  return explanations.length
}

async function refreshSeriesRun(
  runId: string,
  userId: string,
  shouldCancel?: () => boolean
): Promise<number> {
  const scale = await buildRunSimilarityScale(runId)

  const result = await query<
    StoredPickRow & { series_id: string; network: string | null; status: string | null }
  >(
    `SELECT rc.series_id, rc.similarity_score, rc.normalized_similarity, rc.novelty_score,
            rc.rating_score, rc.score_breakdown, s.title, s.year, s.genres, s.overview,
            s.network, s.status
     FROM recommendation_candidates rc
     JOIN series s ON s.id = rc.series_id
     WHERE rc.run_id = $1 AND rc.is_selected = true
     ${PICK_ORDER}`,
    [runId]
  )

  if (result.rows.length === 0) return 0

  const seriesList: SeriesForExplanation[] = result.rows.map((row) => {
    const similarity = numOrNull(row.similarity_score) ?? 0
    const origin = readSlotOrigin(row.score_breakdown)
    return {
      seriesId: row.series_id,
      title: row.title,
      year: row.year,
      genres: row.genres ?? [],
      overview: row.overview,
      network: row.network,
      status: row.status,
      similarity,
      normalizedSimilarity: resolveNormalizedSimilarity(
        row.normalized_similarity,
        similarity,
        scale
      ),
      novelty: numOrNull(row.novelty_score) ?? 0,
      ratingScore: numOrNull(row.rating_score) ?? 0,
      interestText: origin.interestText,
      fromTasteTwin: origin.fromTasteTwin,
      twinSharedIds: origin.twinSharedIds,
      fromAcclaimed: origin.fromAcclaimed,
    }
  })

  const explanations = await generateSeriesExplanations(runId, userId, seriesList, shouldCancel)
  await storeSeriesExplanations(runId, explanations)
  return explanations.length
}

// ============================================================================
// Drivers
// ============================================================================

/**
 * Rewrite the explanations on one user's newest completed run of one media
 * type. Returns null when there is nothing to do, which the callers count as a
 * skip rather than a failure.
 */
export async function refreshExplanationsForRun(
  userId: string,
  mediaType: ExplanationMediaType,
  shouldCancel?: () => boolean
): Promise<{ runId: string; explanations: number } | null> {
  // The same resolution every reader uses, so this rewrites the text that is
  // actually on screen.
  const run = await queryOne<{ id: string }>(
    `SELECT id FROM recommendation_runs
     WHERE user_id = $1 AND status = 'completed' AND media_type = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, mediaType]
  )

  if (!run) return null

  const explanations =
    mediaType === 'movie'
      ? await refreshMovieRun(run.id, userId, shouldCancel)
      : await refreshSeriesRun(run.id, userId, shouldCancel)

  if (explanations === 0) return null

  logger.info({ userId, mediaType, runId: run.id, explanations }, '✅ Explanations refreshed')
  return { runId: run.id, explanations }
}

/**
 * Refresh explanations across users and media types.
 *
 * The AI-explanation setting is honoured per user for the same reason the
 * pipeline honours it: with it off nothing renders the column, so generating
 * text would be spending money on something unreadable.
 */
export async function refreshExplanations(
  options: ExplanationRefreshOptions = {},
  existingJobId?: string
): Promise<ExplanationRefreshResult> {
  const jobId = existingJobId || randomUUID()
  const mediaTypes = options.mediaTypes?.length ? options.mediaTypes : ALL_MEDIA_TYPES

  createJobProgress(jobId, 'refresh-recommendation-explanations', 2)

  try {
    setJobStep(jobId, 0, 'Finding users with recommendations')

    // Joined against the runs rather than filtered on movies_enabled/
    // series_enabled: what decides whether there is work here is whether a
    // completed run exists, and a user whose media type was switched off still
    // has picks on file that a refresh can legitimately repair.
    const users = options.userId
      ? await query<{ id: string; username: string }>(
          `SELECT id, username FROM users WHERE id = $1`,
          [options.userId]
        )
      : await query<{ id: string; username: string }>(
          `SELECT DISTINCT u.id, u.username
           FROM users u
           JOIN recommendation_runs r ON r.user_id = u.id AND r.status = 'completed'
           WHERE u.is_enabled = true
           ORDER BY u.username`
        )

    const targets = users.rows.length * mediaTypes.length
    if (targets === 0) {
      addLog(jobId, 'warn', '⚠️ No users with completed recommendation runs')
      const empty = { runs: 0, explanations: 0, skipped: 0, failed: 0, jobId }
      completeJob(jobId, empty)
      return empty
    }

    addLog(jobId, 'info', `👥 Refreshing explanations for ${users.rows.length} user(s)`)
    setJobStep(jobId, 1, 'Rewriting explanations', targets)

    let runs = 0
    let explanations = 0
    let skipped = 0
    let failed = 0
    let done = 0

    // Every text-generation call in here costs money and the whole job is
    // minutes long, so an admin's Cancel has to actually stop it. Checked once
    // per target and again between batches inside the generators, which puts
    // the worst case at one in-flight request rather than one whole user.
    const shouldCancel = () => isJobCancelled(jobId)
    let cancelled = false

    for (const user of users.rows) {
      if (shouldCancel()) {
        cancelled = true
        break
      }

      const allowed = await getEffectiveAiExplanationSetting(user.id)

      for (const mediaType of mediaTypes) {
        if (shouldCancel()) {
          cancelled = true
          break
        }

        done++

        if (!allowed) {
          skipped++
          addLog(jobId, 'info', `⏭️ ${user.username}: AI explanations disabled`)
          updateJobProgress(jobId, done, targets, `${runs} run(s), ${explanations} explanations`)
          continue
        }

        try {
          const result = await refreshExplanationsForRun(user.id, mediaType, shouldCancel)
          if (!result) {
            skipped++
            addLog(jobId, 'info', `⏭️ ${user.username}: no ${mediaType} picks to explain`)
          } else {
            runs++
            explanations += result.explanations
            addLog(
              jobId,
              'info',
              `✅ ${user.username}: ${result.explanations} ${mediaType} explanation(s)`
            )
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          logger.error({ err, userId: user.id, mediaType }, 'Failed to refresh explanations')
          addLog(jobId, 'error', `❌ ${user.username} (${mediaType}): ${message}`)
          failed++
        }

        updateJobProgress(jobId, done, targets, `${runs} run(s), ${explanations} explanations`)
      }

      if (cancelled) break
    }

    const result = { runs, explanations, skipped, failed, jobId }

    if (cancelled) {
      // cancelJob has already set the status and written the job_runs row.
      // Completing it here would overwrite that with 'completed' and file a
      // second row for the same run.
      addLog(
        jobId,
        'warn',
        `🛑 Cancelled after ${explanations} explanation(s) across ${runs} run(s) — the rest keep their previous text`
      )
      logger.info({ jobId, runs, explanations }, 'Explanation refresh cancelled')
      return result
    }

    if (failed > 0) {
      addLog(jobId, 'warn', `⚠️ Finished with ${failed} failure(s): ${explanations} explanations rewritten across ${runs} run(s)`)
    } else {
      addLog(jobId, 'info', `🎉 ${explanations} explanation(s) rewritten across ${runs} run(s), ${skipped} skipped`)
    }

    completeJob(jobId, result)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    addLog(jobId, 'error', `❌ Job failed: ${message}`)
    failJob(jobId, message)
    throw err
  }
}

/** Job entry point: every user, both media types. */
export async function refreshAllExplanations(
  jobId?: string
): Promise<ExplanationRefreshResult> {
  return refreshExplanations({}, jobId)
}
