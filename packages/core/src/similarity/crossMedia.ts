/**
 * Cross-media neighbour selection for the similarity graph.
 *
 * Movies and series are embedded by two different builders into two different
 * tables (`embeddings*` and `series_embeddings*`), but both are produced by the
 * *same* model at the same dimension -- `getActiveEmbeddingTableName` derives
 * both suffixes from one `getCurrentEmbeddingDimensions()` call -- so the two
 * sets of vectors live in one space and a cosine between them is meaningful.
 * That is what makes "show me series like this film" answerable at all.
 *
 * What is *not* safe is comparing the two distance distributions as though they
 * were one. The canonical texts differ systematically: a series text carries a
 * network and the literal string "5 seasons, 62 episodes", a movie text carries
 * a collection name, and neither has a counterpart on the other side. So
 * film-to-film distances and film-to-series distances are two populations, and
 * merging them into one `ORDER BY similarity DESC` lets whichever population
 * happens to sit higher take every slot. On a graph that shows three
 * connections per node, "whichever sits higher takes every slot" means the
 * feature silently does nothing -- which is exactly the failure this code
 * replaces, where a filter that could never match made the toggle a no-op.
 *
 * So cross-media entries get *reserved slots* rather than a place in a shared
 * ranking, the same answer interestSlots.ts and twinSlots.ts reach for the same
 * reason: a sparse or differently-scaled signal cannot win on score, and giving
 * it a bounded allocation is honest where reweighting it would be guesswork.
 *
 * Pure -- no DB access -- so the allocation can be unit-tested without one.
 */

/**
 * Share of a connection list handed to the other media type when cross-media is
 * on.
 *
 * A third is enough that a graph of three connections per node shows one, which
 * is the size the Explore page actually renders and therefore the case that has
 * to work. Higher and a film's neighbourhood stops being mostly films, which is
 * not what a similarity graph is for; lower and the toggle is invisible at
 * small limits all over again.
 */
export const CROSS_MEDIA_SHARE = 1 / 3

/**
 * How many slots of a list of `limit` to reserve for the other media type.
 *
 * Never more than half the list: at the small limits the graph uses, rounding
 * a share up can otherwise hand over every slot there is (at `limit` 1 a
 * naive floor-of-one reservation would make the *only* connection cross-media),
 * and a cross-media view that has crowded out same-media neighbours entirely is
 * a different feature from the one the switch offers.
 *
 * Returns 0 for a non-positive or non-finite limit, so a caller that fetched
 * nothing reserves nothing.
 */
export function crossMediaSlots(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0
  const share = Math.max(1, Math.round(limit * CROSS_MEDIA_SHARE))
  return Math.min(Math.floor(limit / 2), share)
}

/**
 * Choose which of `candidates` survive into a list of `limit`, guaranteeing the
 * other media type its reserved share where the pool can supply one.
 *
 * Input order is the caller's ranking and is respected twice over: within each
 * media group the earliest candidates are taken first, and the returned list is
 * in the caller's original order rather than in selection order. This function
 * decides *which*, never *in what order* -- so a caller that pre-sorted by
 * similarity gets similarity order back, and one that pre-sorted by something
 * else (getGraphForSource prioritises links between center nodes) keeps that.
 *
 * Neither group is allowed to leave the list short. Reserved slots the other
 * type cannot fill go back to same-media, and same-media running out early is
 * topped up from cross-media, so switching the feature on can only change what
 * is in the list -- never how much of it there is.
 */
export function selectWithCrossMediaSlots<T>(
  candidates: T[],
  isCrossMedia: (candidate: T) => boolean,
  limit: number
): T[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  if (candidates.length <= limit) return [...candidates]

  const sameIndices: number[] = []
  const crossIndices: number[] = []
  candidates.forEach((candidate, index) => {
    if (isCrossMedia(candidate)) crossIndices.push(index)
    else sameIndices.push(index)
  })

  const reserved = Math.min(crossMediaSlots(limit), crossIndices.length)
  const chosen = new Set<number>(crossIndices.slice(0, reserved))

  for (const index of sameIndices) {
    if (chosen.size >= limit) break
    chosen.add(index)
  }

  // Same-media exhausted before the list was full: spend the remainder on
  // further cross-media rather than returning a short list.
  for (const index of crossIndices) {
    if (chosen.size >= limit) break
    chosen.add(index)
  }

  return candidates.filter((_, index) => chosen.has(index))
}
