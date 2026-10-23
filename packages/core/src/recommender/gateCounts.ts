/**
 * Row counts the activity gate compares, because a timestamp cannot see a
 * deletion.
 *
 * Every other gate signal is "the newest timestamp in this table", and a
 * deleted row leaves no timestamp behind. Until the watch-history upsert
 * stopped rewriting unchanged rows ([F-156]), that never showed: every sync
 * restamped every surviving row, so the gate regenerated everyone and a
 * removal was covered by accident. Once the gate actually skips people, these
 * removals have to be seen some other way — and they come from many places:
 * a title unplayed or unfavorited on the server, "mark unwatched", a rating
 * removed, an interest or a franchise/genre weight deleted, and a title
 * dropped from the library, which takes every viewer's watch row, rating and
 * PICK with it by ON DELETE CASCADE, with no code anywhere to stamp it.
 *
 * So instead of stamping each delete site (which misses cascades and every
 * site nobody has written yet), each run records how many rows it saw, and
 * the gate regenerates when any count differs. That is complete for
 * deletions whatever caused them: a deletion lowers a count unless an
 * insertion offsets it, and an insertion carries a timestamp newer than the
 * run, which the timestamp signals already catch.
 *
 * Two snapshots, taken at different moments on purpose:
 *
 * - INPUTS are counted in the statement that creates the run row, the same
 *   moment `created_at` (what every timestamp is compared against) is fixed.
 *   Counted at the end instead, a deletion made while the run was working
 *   would be folded into the baseline and never seen.
 * - OUTPUTS (the run's own picks and their evidence) can only be counted once
 *   they are written, so they are counted when the run is finalized. They
 *   matter because a removed title deletes its candidate rows: the viewer is
 *   left one pick short, and nothing in their own history moved.
 *
 * Pure: SQL text and a comparison, no database, pinned by gateCounts.test.ts.
 */

export type GateMediaType = 'movie' | 'series'

/** A snapshot as stored in recommendation_runs.input_counts / output_counts. */
export type GateCounts = Record<string, number>

/**
 * The version of interest matching (recommender/shared/interestEvidence.ts).
 * Bump it when a change to how interests are matched would change a viewer's
 * interest picks: every viewer WITH interests then regenerates once on their
 * next scheduled run, and viewers without interests are untouched (their value
 * stays 0). 1 = picks backed by a genre/keyword on the title (F-158).
 */
export const INTEREST_MATCHING_VERSION = 1

/**
 * The version of the quality rating scoring reads (ratings/unifiedRating.ts).
 * Bump it when a change to that rating would change picks: every viewer then
 * regenerates once on their next scheduled run. 1 = the unified rating,
 * refreshed IMDb plus critics (F-167).
 */
export const QUALITY_RATING_VERSION = 1

/**
 * Keys that a run which predates them must read as 0 rather than be skipped.
 * compareCounts skips a key the stored snapshot lacks (a count added later,
 * which the timestamps still cover); a version marker has no timestamp, so
 * skipping it would mean the change it marks never reaches anyone.
 */
export const ABSENT_MEANS_ZERO = new Set(['interest_matching', 'quality_rating'])

/**
 * Each input count, per media type. Scoped exactly as the matching timestamp
 * signal in activityGate.ts is, so a count and a timestamp always describe the
 * same rows. Every literal here is fixed text, never caller input.
 */
function inputCountQueries(mediaType: GateMediaType, user: string): Array<[string, string]> {
  const isMovie = mediaType === 'movie'
  const counts: Array<[string, string]> = [
    [
      'watch_history',
      `SELECT COUNT(*) FROM watch_history WHERE user_id = ${user} AND media_type = '${isMovie ? 'movie' : 'episode'}'`,
    ],
    [
      'ratings',
      `SELECT COUNT(*) FROM user_ratings WHERE user_id = ${user} AND ${isMovie ? 'movie_id' : 'series_id'} IS NOT NULL`,
    ],
    [
      'taste_profile',
      `SELECT COUNT(*) FROM user_taste_profiles WHERE user_id = ${user} AND media_type = '${mediaType}'`,
    ],
    ['preferences', `SELECT COUNT(*) FROM user_preferences WHERE user_id = ${user}`],
    ['settings', `SELECT COUNT(*) FROM user_settings WHERE user_id = ${user}`],
    [
      'franchise_preferences',
      `SELECT COUNT(*) FROM user_franchise_preferences WHERE user_id = ${user} AND media_type IN ('${mediaType}', 'both')`,
    ],
    ['genre_weights', `SELECT COUNT(*) FROM user_genre_weights WHERE user_id = ${user}`],
    ['custom_interests', `SELECT COUNT(*) FROM user_custom_interests WHERE user_id = ${user}`],
  ]
  // Not a count: which version of interest matching a run used, and only for
  // a viewer who has interests (0 otherwise). A code change is not a gate
  // signal, so when interest matching changes what a run picks, the viewers
  // it affects regenerate once and nobody else does. Read as 0 when a run
  // stored no such key (ABSENT_MEANS_ZERO).
  counts.push([
    'interest_matching',
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM user_custom_interests WHERE user_id = ${user}) THEN ${INTEREST_MATCHING_VERSION} ELSE 0 END`,
  ])
  // Not a count either: which quality rating scoring read. It applies to every
  // viewer, so a change to it regenerates everyone once.
  counts.push(['quality_rating', `SELECT ${QUALITY_RATING_VERSION}`])
  if (!isMovie) {
    // Series-level favourites live here rather than in watch_history.
    counts.push([
      'watching_series',
      `SELECT COUNT(*) FROM user_watching_series WHERE user_id = ${user}`,
    ])
  }
  return counts
}

function jsonbOfCounts(counts: Array<[string, string]>): string {
  return `jsonb_build_object(${counts.map(([key, sql]) => `'${key}', (${sql})::int`).join(', ')})`
}

/**
 * A `jsonb` expression counting a viewer's recommendation inputs. `user` is
 * the placeholder holding the user id (e.g. `$1`). Used both where the run row
 * is created and where the gate reads the current counts, so the two cannot
 * count different things.
 */
export function inputCountsSql(mediaType: GateMediaType, user: string): string {
  return jsonbOfCounts(inputCountQueries(mediaType, user))
}

/**
 * A `jsonb` expression counting what a run produced and a cascade can take
 * away: its picks and their evidence rows. `run` is the placeholder holding
 * the run id. Thinning and pruning never touch the selected rows of the
 * newest completed run (activityGate.ts), so on that run these only move when
 * a title is deleted.
 */
export function outputCountsSql(run: string): string {
  return jsonbOfCounts([
    [
      'picks',
      `SELECT COUNT(*) FROM recommendation_candidates WHERE run_id = ${run} AND is_selected = true`,
    ],
    [
      'evidence',
      `SELECT COUNT(*) FROM recommendation_evidence e
         JOIN recommendation_candidates c ON c.id = e.candidate_id
        WHERE c.run_id = ${run} AND c.is_selected = true`,
    ],
  ])
}

export type CountComparison =
  | { kind: 'same' }
  /** The run predates the snapshot (or the read failed): nothing to compare. */
  | { kind: 'unknown' }
  | { kind: 'changed'; key: string; stored: number; current: number }

/**
 * Compare a stored snapshot with the current one.
 *
 * Any difference counts, not only a drop. A rise with no newer timestamp
 * should not happen (an insert stamps its row), so if it does something the
 * timestamps cannot see moved, and regenerating is the safe direction.
 *
 * A key present now but absent from the stored snapshot is skipped rather
 * than read as a change: that is a count added after the run was made, and
 * the timestamps still cover it. The exception is a version marker
 * (ABSENT_MEANS_ZERO), which no timestamp covers. Every run made before snapshots existed has
 * NULL and reads as `unknown`, which the gate treats as "regenerate" — one
 * extra run per viewer after the deploy, then normal skipping.
 */
export function compareCounts(
  stored: GateCounts | null | undefined,
  current: GateCounts | null | undefined
): CountComparison {
  if (!stored || !current) return { kind: 'unknown' }
  for (const [key, now] of Object.entries(current)) {
    const then = stored[key] ?? (ABSENT_MEANS_ZERO.has(key) ? 0 : null)
    if (then == null) continue
    if (Number(then) !== Number(now)) {
      return { kind: 'changed', key, stored: Number(then), current: Number(now) }
    }
  }
  return { kind: 'same' }
}

/**
 * Whether a database error is "the 0203 count columns do not exist yet".
 *
 * The run writers record counts in the same statements that create and finalize
 * a run, so on an instance whose image is newer than its schema (migrations
 * run by hand, RUN_MIGRATIONS_ON_START off) those statements would fail and
 * take every recommendation run with them. The gate fails open when it cannot
 * read the columns; the writers must not fail closed. Only an undefined-column
 * error (42703) naming one of the two columns qualifies, so any other missing
 * column, or any other fault, still surfaces.
 */
export function isMissingRunCountsColumn(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const { code, message } = err as { code?: unknown; message?: unknown }
  return code === '42703' && typeof message === 'string' && /\b(?:input|output)_counts\b/.test(message)
}
