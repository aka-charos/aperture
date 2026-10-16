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
import { judgeRunEvidence } from './judgeEvidence.js'
import { ownStandingAt, readOwnStanding, type OwnStanding } from './shared/explanationPrompt.js'
import {
  findNearestSharedTitles,
  storedSharedFields,
  TWIN_SHARED_ORDER_NEAREST,
  type TwinMediaType,
} from './twinNearShared.js'
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
  twinMatch?: { sharedIds?: unknown; sharedOrder?: unknown; donorId?: unknown; ownStanding?: unknown }
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
 * prompt falls back to the bare anonymous line. So does one whose ids carry no
 * `sharedOrder`: those are the RAREST shared titles, unrelated to the pick,
 * and the prompt now introduces whatever it receives as the titles closest to
 * it — handing it the old ones would state a closeness nobody measured.
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
    twinSharedIds:
      parsed.twinMatch?.sharedOrder === TWIN_SHARED_ORDER_NEAREST && Array.isArray(sharedIds)
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
  rank: number | null
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
 * How many titles the run scored and how many it picked, for a twin pick's
 * own standing (twinStandingLine). Null when the run recorded neither, which
 * leaves the twin line without a standing rather than inventing one.
 */
async function readRunListShape(runId: string): Promise<{ scored: number; listSize: number } | null> {
  const run = await queryOne<{ candidate_count: number | null; selected_count: number | null }>(
    `SELECT candidate_count, selected_count FROM recommendation_runs WHERE id = $1`,
    [runId]
  )
  const scored = Number(run?.candidate_count ?? 0)
  const listSize = Number(run?.selected_count ?? 0)
  return scored > 0 && listSize > 0 ? { scored, listSize } : null
}

/**
 * A twin pick's own standing: the one the pipeline stored on twinMatch, else
 * a fallback for runs made before standings were stored.
 *
 * The fallback is approximate, and errs toward a WORSE rank: `rc.rank` and
 * `candidate_count` count the viewer's favourites, which never compete for a
 * slot, so a pick can read slightly further from the list than it was. It is
 * refused outright when the rank exceeds the count, which is what an older run
 * whose stored pool was truncated (F-048) can produce. Undefined for any pick
 * that is not a twin pick.
 */
function resolveStanding(
  breakdown: unknown,
  rank: number | null,
  shape: { scored: number; listSize: number } | null
): OwnStanding | undefined {
  const twin = ((breakdown ?? {}) as StoredBreakdown).twinMatch
  if (twin == null) return undefined
  const stored = readOwnStanding(twin.ownStanding)
  if (stored) return stored
  if (rank == null || !shape) return undefined
  return ownStandingAt(Number(rank) - 1, shape.scored, shape.listSize)
}

/**
 * Ordered by the rank the reader sees, so the numbering in the prompt matches
 * the list on the page — which matters only for the log line, but costs
 * nothing. selected_rank can be null on runs made before it existed, hence the
 * fallback to the pool rank.
 */
const PICK_ORDER = `ORDER BY rc.selected_rank NULLS LAST, rc.rank`

/**
 * Re-choose the titles shown beside each twin pick, and store them back on the
 * pick's score_breakdown.
 *
 * Runs made before twinNearShared.ts hold the RAREST titles the pair shared --
 * an arbitrary slice of a tie, unrelated to the pick -- and the explanation
 * prompt used to be told to build the reason on them. Recomputing here is what
 * lets this job repair an existing run without re-scoring it: the prose it is
 * about to write and the row the insights panel draws then name the same
 * titles. Recomputed for newer runs too, since both viewers' histories move.
 *
 * A pick with nothing to show has its shared fields REMOVED, which every
 * reader renders as the plain twin line -- deliberately not a fallback to the
 * rarest titles. A failed lookup writes nothing and returns an empty map, so
 * the generator reads the stored ids through readSlotOrigin, which uses them
 * only when they were chosen by closeness. Returns item id -> ids.
 */
async function refreshTwinSharedIds(
  runId: string,
  userId: string,
  mediaType: TwinMediaType,
  rows: Array<{ itemId: string; breakdown: unknown; standing?: OwnStanding }>
): Promise<Map<string, string[]>> {
  const standingById = new Map(rows.map((row) => [row.itemId, row.standing]))
  const picks = rows.flatMap(({ itemId, breakdown }) => {
    const donorId = ((breakdown ?? {}) as StoredBreakdown).twinMatch?.donorId
    return typeof donorId === 'string' && donorId ? [{ itemId, donorId }] : []
  })
  if (picks.length === 0) return new Map()

  const nearest = await findNearestSharedTitles(mediaType, userId, picks)
  if (!nearest) return new Map()

  const itemIds = picks.map((pick) => pick.itemId)
  // The same fields the pipelines store (storedSharedFields, plus the
  // standing), so a refreshed pick and a freshly scored one are
  // indistinguishable to every reader — including the insights banner, which
  // reads the standing off the row.
  const fieldSets = itemIds.map((id) => {
    const standing = standingById.get(id)
    return JSON.stringify({
      ...storedSharedFields(nearest.get(id)),
      ...(standing ? { ownStanding: standing } : {}),
    })
  })
  const column = mediaType === 'movie' ? 'movie_id' : 'series_id'

  try {
    // Drop the old shared fields, then merge the new ones (possibly none).
    await query(
      `UPDATE recommendation_candidates rc
          SET score_breakdown = jsonb_set(
                rc.score_breakdown,
                '{twinMatch}',
                ((rc.score_breakdown->'twinMatch') - 'sharedIds' - 'sharedSimilarities' - 'sharedOrder' - 'ownStanding')
                  || u.fields::jsonb)
         FROM unnest($2::uuid[], $3::text[]) AS u(item_id, fields)
        WHERE rc.run_id = $1
          AND rc.${column} = u.item_id
          AND jsonb_typeof(rc.score_breakdown->'twinMatch') = 'object'`,
      [runId, itemIds, fieldSets]
    )
  } catch (err) {
    // The prose still gets the recomputed titles; only the panel keeps the old
    // row until the next refresh.
    logger.warn({ err, runId, mediaType }, 'Could not store recomputed twin shared titles')
  }

  return new Map(itemIds.map((id) => [id, (nearest.get(id) ?? []).map((title) => title.id)]))
}

async function refreshMovieRun(
  runId: string,
  userId: string,
  shouldCancel?: () => boolean,
  onlyItemId?: string
): Promise<number> {
  const scale = await buildRunSimilarityScale(runId)

  const result = await query<StoredPickRow & { movie_id: string }>(
    `SELECT rc.movie_id, rc.similarity_score, rc.normalized_similarity, rc.novelty_score,
            rc.rating_score, rc.score_breakdown, rc.rank, m.title, m.year, m.genres, m.overview
     FROM recommendation_candidates rc
     JOIN movies m ON m.id = rc.movie_id
     WHERE rc.run_id = $1 AND rc.is_selected = true
       AND ($2::uuid IS NULL OR rc.movie_id = $2::uuid)
     ${PICK_ORDER}`,
    [runId, onlyItemId ?? null]
  )

  if (result.rows.length === 0) return 0

  // Picks still missing a decision-model verdict get one first, so switching
  // that integration on and refreshing reaches existing runs without
  // re-scoring them. Off, unconfigured or failing: a no-op. See judgeEvidence.ts.
  // Not for a single pick: judging is run-wide, and one pick's rewrite must
  // not pay for verdicts on the other nineteen.
  if (!onlyItemId) {
    await judgeRunEvidence(runId, 'movie', { shouldCancel, onlyUnjudged: true })
  }

  const shape = await readRunListShape(runId)
  const standings = new Map(
    result.rows.map((row) => [row.movie_id, resolveStanding(row.score_breakdown, row.rank, shape)])
  )

  const twinShared = await refreshTwinSharedIds(
    runId,
    userId,
    'movie',
    result.rows.map((row) => ({
      itemId: row.movie_id,
      breakdown: row.score_breakdown,
      standing: standings.get(row.movie_id),
    }))
  )

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
      twinSharedIds: twinShared.get(row.movie_id) ?? origin.twinSharedIds,
      ownStanding: standings.get(row.movie_id),
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
  shouldCancel?: () => boolean,
  onlyItemId?: string
): Promise<number> {
  const scale = await buildRunSimilarityScale(runId)

  const result = await query<
    StoredPickRow & { series_id: string; network: string | null; status: string | null }
  >(
    `SELECT rc.series_id, rc.similarity_score, rc.normalized_similarity, rc.novelty_score,
            rc.rating_score, rc.score_breakdown, rc.rank, s.title, s.year, s.genres, s.overview,
            s.network, s.status
     FROM recommendation_candidates rc
     JOIN series s ON s.id = rc.series_id
     WHERE rc.run_id = $1 AND rc.is_selected = true
       AND ($2::uuid IS NULL OR rc.series_id = $2::uuid)
     ${PICK_ORDER}`,
    [runId, onlyItemId ?? null]
  )

  if (result.rows.length === 0) return 0

  // Mirrors refreshMovieRun: verdicts first, for picks still missing one.
  if (!onlyItemId) {
    await judgeRunEvidence(runId, 'series', { shouldCancel, onlyUnjudged: true })
  }

  const shape = await readRunListShape(runId)
  const standings = new Map(
    result.rows.map((row) => [row.series_id, resolveStanding(row.score_breakdown, row.rank, shape)])
  )

  const twinShared = await refreshTwinSharedIds(
    runId,
    userId,
    'series',
    result.rows.map((row) => ({
      itemId: row.series_id,
      breakdown: row.score_breakdown,
      standing: standings.get(row.series_id),
    }))
  )

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
      twinSharedIds: twinShared.get(row.series_id) ?? origin.twinSharedIds,
      ownStanding: standings.get(row.series_id),
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

export type PickExplanationRefresh =
  | { status: 'refreshed' }
  /** AI explanations are off for this viewer, so nothing would render it. */
  | { status: 'disabled' }
  /** The title is not a pick on the viewer's newest completed run. */
  | { status: 'not-a-pick' }

/**
 * Rewrite the explanation of ONE pick, on the viewer's newest completed run.
 *
 * The job rewrites every pick for every viewer, which is minutes of paid model
 * calls to repair a handful — the twin picks whose prose was built on the
 * rarest shared titles (F-157) being the case this exists for. This is one
 * generation call: the pick's twin shared titles are re-chosen and stored
 * first, as the job does, and run-wide evidence judging is skipped.
 */
export async function refreshExplanationForPick(
  userId: string,
  mediaType: ExplanationMediaType,
  itemId: string
): Promise<PickExplanationRefresh> {
  if (!(await getEffectiveAiExplanationSetting(userId))) return { status: 'disabled' }

  const run = await queryOne<{ id: string }>(
    `SELECT id FROM recommendation_runs
     WHERE user_id = $1 AND status = 'completed' AND media_type = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, mediaType]
  )
  if (!run) return { status: 'not-a-pick' }

  const written =
    mediaType === 'movie'
      ? await refreshMovieRun(run.id, userId, undefined, itemId)
      : await refreshSeriesRun(run.id, userId, undefined, itemId)
  if (written === 0) return { status: 'not-a-pick' }

  logger.info({ userId, mediaType, runId: run.id, itemId }, '✅ Explanation refreshed for one pick')
  return { status: 'refreshed' }
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
