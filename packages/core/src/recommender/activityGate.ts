/**
 * Should we regenerate this user's recommendations at all?
 *
 * The scheduled job was doing full pipeline work for every user on every run —
 * pgvector retrieval over the whole catalogue, scoring, and one LLM call per
 * batch of explanations — with no check for whether anything that feeds the
 * result had changed since last time. For an instance where most people watch
 * something once a fortnight, that is a weekly bill for recomputing an
 * identical answer.
 *
 * This answers the cheap version of the question first: has any input moved
 * since the last completed run? All signals are indexed MAX() lookups, so the
 * check costs microseconds against a pipeline that costs minutes.
 *
 * Two deliberate safety properties:
 *
 * 1. **Fails open.** Any error, and any signal we cannot read, returns
 *    "regenerate" — the pre-existing behaviour. A bug here can waste compute;
 *    it can never silently freeze someone's recommendations.
 * 2. **Has a maximum age.** Even with every signal quiet, a run older than
 *    `maxRunAgeDays` regenerates. The signal list below is necessarily
 *    incomplete — enrichment rewriting a synopsis, a prompt change, a scoring
 *    change in code — and this is what stops an input nobody thought to
 *    enumerate stranding a user on stale picks forever.
 *
 * Note what is NOT a signal: `movies.updated_at` / `series.updated_at`. The
 * sync job rewrites every catalogue row every few hours, so the trigger bumps
 * those columns constantly and gating on them would mean never skipping
 * anybody. New titles are caught by created_at, and newly-embedded titles by
 * the embedding table's created_at, which are the two ways the candidate pool
 * actually grows.
 *
 * Both numbers are admin-configurable per media type (Settings → AI Config →
 * Algorithm, stored on `recommendation_config`); the constants below are the
 * fallback for a config read that fails.
 */

import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getActiveEmbeddingTableName } from '../lib/ai-provider.js'
import { getRecommendationConfig } from '../lib/recommendationConfig.js'

const logger = createChildLogger('recommender-activity-gate')

/**
 * Runs to keep per user per media type. Enough to back the run-history view
 * and to compare a couple of generations by hand; past that the rows were only
 * ever accumulating.
 */
export const RECOMMENDATION_RUNS_TO_KEEP = 10

export type RecommendationMediaType = 'movie' | 'series'

export interface GateThresholds {
  /**
   * How many newly-available titles it takes before the catalogue counts as
   * having changed.
   *
   * This one is a threshold rather than a timestamp because the catalogue is a
   * *global* signal: gating on "is there anything newer than your last run"
   * would mean one new film in the library forces every user to regenerate, and
   * on an instance that acquires content weekly the gate would never once fire.
   *
   * A handful of arrivals almost never displaces anything in a top-20 drawn
   * from tens of thousands of candidates, so requiring a batch trades a
   * negligible chance of a slightly stale list for the skip actually happening.
   * The age valve is the backstop for a library that grows slowly but steadily.
   */
  newCandidateThreshold: number
  /**
   * Regenerate regardless once the last run is this old. Long enough that a
   * genuinely inactive user is skipped for several weekly runs, short enough
   * that any unenumerated input reaches everyone within about a month.
   */
  maxRunAgeDays: number
}

/**
 * Used only when the config read fails. Kept in step with the column defaults
 * in migration 0131 — series sits lower because shows arrive far less often
 * than films, so the same batch size would never accumulate.
 */
export const DEFAULT_GATE_THRESHOLDS: Record<RecommendationMediaType, GateThresholds> = {
  movie: { newCandidateThreshold: 12, maxRunAgeDays: 35 },
  series: { newCandidateThreshold: 6, maxRunAgeDays: 35 },
}

export interface RegenerationDecision {
  regenerate: boolean
  /** Stable identifier for logs — never user-facing prose */
  reason:
    | 'no-previous-run'
    | 'max-age'
    | 'watch-history'
    | 'ratings'
    | 'taste-profile'
    | 'preferences'
    | 'new-candidates'
    | 'config'
    | 'check-failed'
    | 'unchanged'
  lastRunAt: Date | null
  /** The newest input timestamp we found, when that is what triggered the run */
  changedAt: Date | null
}

const REGENERATE = (
  reason: RegenerationDecision['reason'],
  lastRunAt: Date | null = null,
  changedAt: Date | null = null
): RegenerationDecision => ({ regenerate: true, reason, lastRunAt, changedAt })

interface SignalRow {
  watch_history: Date | null
  ratings: Date | null
  taste_profile: Date | null
  preferences: Date | null
  config: Date | null
  /** Titles that became available to recommend since the last run */
  new_candidate_count: number
}

/**
 * The comparison itself, with the database taken out of it.
 *
 * Split from the query so the part that is easy to get backwards — which
 * direction the comparison runs, whether the age valve fires before or after
 * the signals, how a NULL signal is treated — can be pinned by tests rather
 * than only ever exercised against a live instance.
 */
export function decideRegeneration(
  lastRunAt: Date | null,
  signals: Partial<SignalRow> | null,
  thresholds: GateThresholds,
  now: Date = new Date()
): RegenerationDecision {
  if (!lastRunAt) return REGENERATE('no-previous-run')

  const ageDays = (now.getTime() - lastRunAt.getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays > thresholds.maxRunAgeDays) return REGENERATE('max-age', lastRunAt)

  // A missing row means we could not read the signals at all, which is not
  // evidence that nothing changed.
  if (!signals) return REGENERATE('check-failed', lastRunAt)

  const checks: Array<[RegenerationDecision['reason'], Date | null | undefined]> = [
    ['watch-history', signals.watch_history],
    ['ratings', signals.ratings],
    ['taste-profile', signals.taste_profile],
    ['preferences', signals.preferences],
    ['config', signals.config],
  ]

  for (const [reason, changedAt] of checks) {
    // A NULL signal means the user has no such row — nothing to compare, not a
    // change. Only a timestamp strictly newer than the run counts.
    if (changedAt && changedAt.getTime() > lastRunAt.getTime()) {
      return REGENERATE(reason, lastRunAt, changedAt)
    }
  }

  // Counted, not compared: see GateThresholds.newCandidateThreshold.
  if ((signals.new_candidate_count ?? 0) >= thresholds.newCandidateThreshold) {
    return REGENERATE('new-candidates', lastRunAt)
  }

  return { regenerate: false, reason: 'unchanged', lastRunAt, changedAt: null }
}

/**
 * One round trip for every per-user signal. Written as scalar subqueries
 * rather than joins so each one is an independent index lookup and a user with
 * no row in a given table contributes NULL rather than dropping the result.
 */
async function readSignals(
  userId: string,
  mediaType: RecommendationMediaType,
  embeddingTable: string | null,
  lastRunAt: Date,
  thresholds: GateThresholds
): Promise<SignalRow | null> {
  const isMovie = mediaType === 'movie'

  // watch_history stores episodes under media_type 'episode'; series-level
  // favorites leave no row there at all and arrive via user_watching_series,
  // which is why the series branch unions it in (see builder.ts).
  const watchHistorySql = isMovie
    ? `SELECT MAX(updated_at) FROM watch_history WHERE user_id = $1 AND media_type = 'movie'`
    : `SELECT GREATEST(
         (SELECT MAX(updated_at) FROM watch_history WHERE user_id = $1 AND media_type = 'episode'),
         (SELECT MAX(added_at) FROM user_watching_series WHERE user_id = $1)
       )`

  const ratingsSql = isMovie
    ? `SELECT MAX(updated_at) FROM user_ratings WHERE user_id = $1 AND movie_id IS NOT NULL`
    : `SELECT MAX(updated_at) FROM user_ratings WHERE user_id = $1 AND series_id IS NOT NULL`

  const catalogTable = isMovie ? 'movies' : 'series'

  // A newly-embedded title becomes recommendable even though its catalogue row
  // is old, so both halves count. The embedding half is dropped when no model
  // is configured — the pipeline reports that problem itself. Capped by LIMIT
  // so this stays an early-exit scan rather than counting a whole fresh import.
  const cap = Math.max(1, Math.trunc(thresholds.newCandidateThreshold))
  const newCandidatesSql = embeddingTable
    ? `SELECT COUNT(*) FROM (
         SELECT 1 FROM ${catalogTable} WHERE created_at > $3
          UNION ALL
         SELECT 1 FROM ${embeddingTable} WHERE created_at > $3
         LIMIT ${cap}
       ) capped`
    : `SELECT COUNT(*) FROM (
         SELECT 1 FROM ${catalogTable} WHERE created_at > $3
         LIMIT ${cap}
       ) capped`

  return queryOne<SignalRow>(
    `SELECT
       (${watchHistorySql}) AS watch_history,
       (${ratingsSql}) AS ratings,
       (SELECT GREATEST(auto_updated_at, user_modified_at)
          FROM user_taste_profiles WHERE user_id = $1 AND media_type = $2) AS taste_profile,
       GREATEST(
         (SELECT MAX(updated_at) FROM user_preferences WHERE user_id = $1),
         (SELECT MAX(updated_at) FROM user_settings WHERE user_id = $1),
         (SELECT MAX(updated_at) FROM user_franchise_preferences
            WHERE user_id = $1 AND (media_type = $2 OR media_type = 'both')),
         (SELECT MAX(updated_at) FROM user_genre_weights WHERE user_id = $1),
         (SELECT MAX(created_at) FROM user_custom_interests WHERE user_id = $1)
       ) AS preferences,
       -- scoring_updated_at, not updated_at: the row's trigger fires on any
       -- write, including edits to the gate's own thresholds, which are not a
       -- reason to recompute anyone's picks.
       (SELECT MAX(scoring_updated_at) FROM recommendation_config) AS config,
       (${newCandidatesSql})::int AS new_candidate_count`,
    [userId, mediaType, lastRunAt]
  )
}

/**
 * The admin-configured thresholds for one media type, falling back to the
 * shipped defaults rather than failing the check outright — a config read that
 * throws should not be the reason nobody's picks ever refresh.
 */
async function getGateThresholds(
  mediaType: RecommendationMediaType
): Promise<GateThresholds> {
  try {
    const config = await getRecommendationConfig()
    const forType = mediaType === 'movie' ? config.movie : config.series
    return {
      newCandidateThreshold: forType.newCandidateThreshold,
      maxRunAgeDays: forType.maxRunAgeDays,
    }
  } catch (err) {
    logger.warn({ err, mediaType }, 'Could not read gate thresholds, using defaults')
    return DEFAULT_GATE_THRESHOLDS[mediaType]
  }
}

/**
 * Decide whether a user's recommendations need regenerating.
 *
 * Compares every input against the last *completed* run — a failed or
 * still-running row is not evidence that a good answer exists.
 */
export async function shouldRegenerateRecommendations(
  userId: string,
  mediaType: RecommendationMediaType
): Promise<RegenerationDecision> {
  try {
    const lastRun = await queryOne<{ created_at: Date }>(
      `SELECT created_at FROM recommendation_runs
        WHERE user_id = $1 AND media_type = $2 AND status = 'completed'
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId, mediaType]
    )

    if (!lastRun) return REGENERATE('no-previous-run')

    const thresholds = await getGateThresholds(mediaType)

    // Age valve first, so an instance whose signals are all quiet still cannot
    // strand anyone — and so we skip the signal query entirely in that case.
    const lastRunAt = lastRun.created_at
    const ageDays = (Date.now() - lastRunAt.getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays > thresholds.maxRunAgeDays) return REGENERATE('max-age', lastRunAt)

    let embeddingTable: string | null = null
    try {
      embeddingTable = await getActiveEmbeddingTableName(
        mediaType === 'movie' ? 'embeddings' : 'series_embeddings'
      )
    } catch {
      // No embedding model configured. The catalogue half of the signal still
      // works, and the pipeline will report the real problem itself.
    }

    const signals = await readSignals(userId, mediaType, embeddingTable, lastRunAt, thresholds)
    return decideRegeneration(lastRunAt, signals, thresholds)
  } catch (err) {
    // Fails open: a broken check must cost compute, never correctness.
    logger.warn({ err, userId, mediaType }, 'Activity check failed, regenerating anyway')
    return REGENERATE('check-failed')
  }
}

/**
 * Delete the non-selected candidates of every run except the newest completed
 * one.
 *
 * Rows past the picks exist to explain a title the user browses, and the
 * insights panel resolves exactly one run to do that: the newest completed one.
 * Keeping the full scored list on older runs would therefore store thousands of
 * rows per user per run that nothing can display. Run history is unaffected —
 * it only ever showed the picks.
 *
 * The consequence worth knowing when reading this table by hand: an old run
 * legitimately holds a dozen candidates while the newest holds thousands. That
 * asymmetry is deliberate, not damage.
 *
 * Comparing against the newest *completed* run rather than the newest row of
 * any status is load-bearing. Readers skip failed runs, so a failed run sitting
 * on top does not blank the panel — but thinning the completed run underneath
 * it would. With no completed run at all the subquery is NULL, `<> NULL`
 * matches nothing and this no-ops, which is the safe direction to fail.
 */
async function thinSupersededCandidates(
  userId: string,
  mediaType: RecommendationMediaType
): Promise<number> {
  try {
    const result = await query(
      `DELETE FROM recommendation_candidates c
        USING recommendation_runs r
        WHERE c.run_id = r.id
          AND r.user_id = $1
          AND r.media_type = $2
          AND r.channel_id IS NULL
          AND c.is_selected = false
          AND r.id <> (
            SELECT id FROM recommendation_runs
             WHERE user_id = $1 AND media_type = $2 AND channel_id IS NULL
               AND status = 'completed'
             ORDER BY created_at DESC
             LIMIT 1
          )`,
      [userId, mediaType]
    )
    return result.rowCount ?? 0
  } catch (err) {
    // Same contract as the run sweep below: housekeeping never fails a run.
    logger.warn({ err, userId, mediaType }, 'Failed to thin superseded candidates')
    return 0
  }
}

/**
 * Delete a user's recommendation runs beyond the newest `keep`, then thin the
 * survivors down to their picks.
 *
 * Nothing pruned these, so every scheduled run appended a row set —
 * recommendation_runs plus its candidates and evidence — that was never read
 * again. Only the full reset and the per-user regenerate button ever deleted
 * anything, and both are all-or-nothing.
 *
 * The newest completed run is what /api/recommendations serves, so ordering by
 * created_at DESC and keeping a prefix is load-bearing, not tidiness: deleting
 * the wrong row blanks the user's page. Cascades take candidates and evidence
 * with the run.
 */
export async function pruneOldRecommendationRuns(
  userId: string,
  mediaType: RecommendationMediaType,
  keep: number
): Promise<number> {
  if (keep < 1) throw new Error('pruneOldRecommendationRuns: keep must be at least 1')

  let deleted = 0

  try {
    const result = await query(
      `DELETE FROM recommendation_runs
        WHERE id IN (
          SELECT id FROM recommendation_runs
           WHERE user_id = $1 AND media_type = $2
             -- The schema anticipates channel-owned runs (run_type 'channel',
             -- channel_id set). Nothing writes them today, but a per-user
             -- retention sweep has no business deleting a run some channel
             -- points at if that comes back.
             AND channel_id IS NULL
           ORDER BY created_at DESC
           OFFSET $3
        )`,
      [userId, mediaType, keep]
    )

    deleted = result.rowCount ?? 0
  } catch (err) {
    // Housekeeping must never fail a run that already produced good picks.
    logger.warn({ err, userId, mediaType }, 'Failed to prune old recommendation runs')
  }

  // Second phase, deliberately outside that catch: the runs kept above still
  // hold a full scored list each, and only the newest completed one is ever
  // read. Thinning is worth doing even when the sweep above failed.
  const thinned = await thinSupersededCandidates(userId, mediaType)

  if (deleted > 0 || thinned > 0) {
    logger.info({ userId, mediaType, deleted, thinned, keep }, 'Pruned old recommendation runs')
  }

  return deleted
}
