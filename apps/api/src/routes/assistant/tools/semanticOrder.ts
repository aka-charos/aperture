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
 * Two nearest-first lists as one, alternating by rank (movie 1, series 1,
 * movie 2, ...), up to `limit`. When one side runs out the other fills the
 * remaining slots, so a search of one media type is that list, in its order.
 *
 * Titles are compared here, as they are placed, rather than before the merge: a
 * title dropped from one side in favour of a copy on the other side that then
 * falls past the limit would be in neither. So of two rows with one title the
 * nearer by rank is the one shown, and the movie on a tie. A skipped row does not
 * use up its side's turn.
 *
 * @param excludeLower lowercase; a title containing it is left out
 */
export function mergeNearestByRank<T extends { name: string }>(
  movies: readonly T[],
  series: readonly T[],
  limit: number,
  excludeLower?: string
): T[] {
  const merged: T[] = []
  const seenTitles = new Set<string>()
  const sides = [movies[Symbol.iterator](), series[Symbol.iterator]()] as const

  const nextFrom = (side: Iterator<T>): T | undefined => {
    for (let step = side.next(); !step.done; step = side.next()) {
      const titleKey = step.value.name.toLowerCase()
      if (excludeLower && titleKey.includes(excludeLower)) continue
      if (seenTitles.has(titleKey)) continue
      seenTitles.add(titleKey)
      return step.value
    }
    return undefined
  }

  let turn: 0 | 1 = 0
  while (merged.length < limit) {
    const other: 0 | 1 = turn === 0 ? 1 : 0
    const item = nextFrom(sides[turn]) ?? nextFrom(sides[other])
    if (!item) break
    merged.push(item)
    turn = other
  }
  return merged
}
