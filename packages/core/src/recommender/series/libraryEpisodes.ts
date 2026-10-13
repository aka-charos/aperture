/**
 * How much of a show a viewer got through, measured against what the LIBRARY
 * holds.
 *
 * `series.total_episodes` was meant to be that denominator ([F-039]) and is
 * NULL on every show on an Emby library: the sync requests `RecursiveItemCount`
 * and Emby does not return it on the listing the sync reads, and the sync then
 * rewrites the column every pass. So `completionMultiplier` never ran — a show
 * dropped after two episodes weighed the same as one watched to the end — and
 * nothing said so, because "no total" is also the legitimate "can't tell" case.
 *
 * The episodes table is what the library actually holds, which is the
 * denominator [F-039] asks for (owning one season of five and finishing it is
 * finishing). Specials (season 0) are left out of BOTH halves, as the poster's
 * `8/24` pill leaves them out (`watching/watchedItems.ts`): counted in the
 * total they would hold a finished show below the top band, and counted in the
 * watched half they could push a rate past 1.
 */

/**
 * The library's regular episodes of `seriesId` (an SQL expression), as an int,
 * or NULL when it holds none — NULL keeps the "can't tell" reading rather than
 * dividing by zero.
 */
export function libraryEpisodeCountSql(seriesId: string): string {
  return `(SELECT NULLIF(COUNT(*), 0)::int FROM episodes le WHERE le.series_id = ${seriesId} AND le.season_number > 0)`
}

/** For an aggregate over episodes aliased `e`: only regular episodes. */
export const REGULAR_EPISODE_SQL = 'e.season_number > 0'

/**
 * Watched share of the library's episodes, or undefined when there is no
 * library total to divide by. Both inputs may arrive as the strings pg returns
 * for counts. The callers count watched episodes through a join to
 * `episodes`, so the rate cannot pass 1; the clamp is a guard for a caller
 * that does not.
 */
export function seriesCompletionRate(
  regularWatched: number | string | null | undefined,
  libraryEpisodes: number | string | null | undefined
): number | undefined {
  if (libraryEpisodes == null) return undefined
  const total = Number(libraryEpisodes)
  if (!Number.isFinite(total) || total <= 0) return undefined
  const watched = regularWatched == null ? 0 : Number(regularWatched)
  if (!Number.isFinite(watched) || watched <= 0) return 0
  return Math.min(watched / total, 1)
}
