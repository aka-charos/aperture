/**
 * How much of a viewer's history the "similar to what you've watched" lookup
 * searches.
 *
 * Both pipelines used to hand `storeEvidence` the *same* list they built the
 * taste vector from — `recentWatchLimit`, default 50, ordered favourites-first.
 * That is the right size for a centroid (it is a weighted mean, and the tail
 * contributes almost nothing) and quite wrong for a nearest-neighbour lookup:
 * for a viewer with 3,510 watched films it searched 1.4% of their history and
 * then labelled the result "based on your history with similar movies". Whatever
 * genuinely sat closest to a pick was, in almost every case, simply not in the
 * candidate set — so the three titles shown were the nearest among a handful of
 * favourites, and the explanation model, which is instructed to build its answer
 * from exactly those titles and invent nothing, was reasoning from them.
 *
 * The limit exists only to bound the uuid[] the LATERAL join is given, not
 * because a larger baseline is worse — for this lookup more history is strictly
 * better. At ~40 bytes per id, 5,000 ids is roughly 200 KB on the wire once per
 * user per run, which is nothing next to the embedding scan it drives. Ordering
 * is still favourites-first, so a viewer past the cap loses their least-engaged
 * tail rather than an arbitrary slice.
 *
 * The obvious simplification — drop the array and join `watch_history` inside
 * the LATERAL — is deliberately NOT taken. Passing an explicit id list keeps the
 * planner on a filtered scan; a join predicate beside `ORDER BY embedding <=> …`
 * is exactly the shape that lets it choose the HNSW index and post-filter
 * instead, and an HNSW scan never yields more rows than `ef_search` (default 40
 * in this repo). Watched titles are a small fraction of the index, so the
 * LIMIT 3 would come back short or empty and the evidence would silently
 * disappear. See the assistant's search tools for the same trap and the
 * `SET LOCAL hnsw.ef_search` workaround it needs.
 */
export const EVIDENCE_HISTORY_LIMIT = 5000
