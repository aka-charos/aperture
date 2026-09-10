/**
 * Ranking for a search that runs *inside* the user's already-scored pool.
 *
 * The recommender scores the user's whole unwatched library on every run and
 * stores all of it (recommender/storage.ts). Chat could only ever see the
 * handful marked is_selected, so a request like "something arthouse" fell
 * through to semanticSearch — plain cosine against the phrase, with nothing
 * about the viewer in the ranking at all. Blending the query similarity with
 * the stored final_score reuses the entire pipeline (taste vector, novelty,
 * quality, watched exclusion) for the cost of one join.
 *
 * Kept pure and separate from the SQL so the part that can silently go wrong is
 * testable without a database.
 */

/** How much of the ranking the request itself commands. */
export const QUERY_WEIGHT = 0.6

/**
 * The same weight, mirrored — for a section that answers the user's TASTE with
 * the request as the tiebreak, rather than the request with taste as the
 * tiebreak.
 *
 * Defined as the mirror rather than as its own number because the two are one
 * editorial decision seen from both ends: how hard a section leans. Retuning
 * `QUERY_WEIGHT` should move both, or the two sections stop being complements
 * and start being two arbitrary points on the same axis.
 *
 * Going lower was considered and rejected. It is tempting because the pool is
 * already the 400 nearest neighbours of the concept, so topical relevance has a
 * floor no weight can breach — but at the bottom of the range the ordering
 * collapses to `final_score` alone, which is the user's generic recommendation
 * list re-filtered, and the section stops answering *this* request from a taste
 * angle and starts ignoring it. The invariant that matters is only that taste
 * leads (< 0.5); `tasteBlend.test.ts` pins that rather than the exact value.
 */
export const TASTE_SECTION_QUERY_WEIGHT = 1 - QUERY_WEIGHT

export interface BlendableRow {
  /** Cosine between the request embedding and the item, 0-1. */
  queryScore: number
  /** The recommender's stored final_score for this user, 0-1. */
  tasteScore: number
}

/**
 * Scale a term onto 0-1 across the fetched pool.
 *
 * Both terms are normalised before blending, never used raw. Raw cosine in this
 * embedding space occupies a narrow high band — the same cone that made
 * user-centroid similarity useless for taste twins, where 153 real pairs spanned
 * 0.898-0.993 — while final_score spreads over a different range entirely. A
 * straight weighted sum of the two would quietly let whichever term happens to
 * have more spread decide the whole ordering, which is how avgNovelty ended up
 * pinned in [0.8, 1.0] and dispersion read 0.000 for every profile.
 *
 * A term with no spread returns 0 for every row rather than NaN, which leaves
 * the other term deciding — the right behaviour when a measure cannot
 * discriminate.
 */
function normalize(values: number[]): number[] {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return values.map(() => 0)

  const min = Math.min(...finite)
  const max = Math.max(...finite)
  if (max === min) return values.map(() => 0)

  return values.map((v) => (Number.isFinite(v) ? (v - min) / (max - min) : 0))
}

/**
 * Order the pool by request-fit and taste-fit together, best first.
 *
 * `queryWeight` is the request's share; the remainder goes to taste. The
 * request leads on purpose — the user asked for something specific, and a
 * ranking that puts their general taste first would answer a question they
 * didn't ask.
 *
 * Deterministic: ties keep their input order, which is the order the ANN
 * returned them in.
 */
export function blendQueryAndTaste<T extends BlendableRow>(
  rows: T[],
  queryWeight: number = QUERY_WEIGHT
): Array<T & { blendedScore: number }> {
  if (rows.length === 0) return []

  const weight = Number.isFinite(queryWeight) ? Math.min(1, Math.max(0, queryWeight)) : QUERY_WEIGHT
  const queryScores = normalize(rows.map((r) => r.queryScore))
  const tasteScores = normalize(rows.map((r) => r.tasteScore))

  return rows
    .map((row, i) => ({
      ...row,
      blendedScore: queryScores[i]! * weight + tasteScores[i]! * (1 - weight),
      _index: i,
    }))
    .sort((a, b) => b.blendedScore - a.blendedScore || a._index - b._index)
    .map(({ _index, ...rest }) => rest as T & { blendedScore: number })
}
