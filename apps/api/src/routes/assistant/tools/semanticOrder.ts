/**
 * The order of `semanticSearch`'s answer: nearest first, whatever the rating.
 *
 * The cards say "closest to" and the prompt says "ranked by text similarity
 * ALONE", so the list has to be that. Within one media type the database's
 * `ORDER BY` already is. Across the two it cannot be: movies and series share a
 * vector space, but their distance distributions are two populations (see
 * core `similarity/crossMedia.ts`), so sorting them together hands every slot
 * to whichever sits higher. A title's rank within its own media type is the one
 * thing that compares, so the two lists alternate by rank.
 *
 * `selectWithCrossMediaSlots` is not used here: its reserved share assumes a
 * centre title whose media type is the main one, and a text query has none.
 *
 * Pure -- no DB access -- so the order can be tested without one.
 */

/**
 * The rows of one media type worth keeping, in the order they arrived.
 *
 * Skips the title the user asked to exclude and any title already in `seenTitles`,
 * which it adds to. Passing the movie rows first is what makes the movie win when
 * a movie and a series share a title.
 *
 * @param excludeLower lowercase; matched as a substring of the title
 */
export function keepNewTitles<T extends { title: string }>(
  rows: readonly T[],
  seenTitles: Set<string>,
  excludeLower?: string
): T[] {
  const kept: T[] = []
  for (const row of rows) {
    const titleKey = row.title.toLowerCase()
    if (excludeLower && titleKey.includes(excludeLower)) continue
    if (seenTitles.has(titleKey)) continue
    seenTitles.add(titleKey)
    kept.push(row)
  }
  return kept
}

/**
 * Two nearest-first lists as one, alternating by rank (movie 1, series 1,
 * movie 2, ...), cut to `limit`. When one side runs out the other fills the
 * remaining slots, so a search of one media type is that list, in its order.
 */
export function mergeNearestByRank<T>(
  movies: readonly T[],
  series: readonly T[],
  limit: number
): T[] {
  const merged: T[] = []
  for (let rank = 0; rank < Math.max(movies.length, series.length); rank++) {
    if (rank < movies.length) merged.push(movies[rank]!)
    if (rank < series.length) merged.push(series[rank]!)
  }
  return merged.slice(0, limit)
}
