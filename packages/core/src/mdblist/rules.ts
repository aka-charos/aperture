/**
 * MDBList enrichment rules (pure, no DB, no network).
 *
 * Which titles are due, and how a batch answer is read. Kept apart from the
 * client so a test can pin them without the core barrel's DB pool.
 */

/**
 * How long a title's MDBList answer is trusted before it is asked again.
 *
 * Streaming providers change month to month and the scores drift, so the
 * stamp is a freshness date, not a "done forever" flag. A whole library is
 * about one request per 100 titles, so a monthly refresh costs a 13k-title
 * library some 140 requests a month.
 */
export const MDBLIST_REFRESH_DAYS = 30

/**
 * The one definition of "this title is due for MDBList", shared by the job's
 * counts and its selections (a count that disagrees with the selection makes
 * a run look stalled or finished early). Never asked before, or asked longer
 * ago than the refresh window; and there is an id to ask with.
 */
export const MDBLIST_PENDING_SQL = `(
    (mdblist_enriched_at IS NULL
      OR mdblist_enriched_at < NOW() - INTERVAL '${MDBLIST_REFRESH_DAYS} days')
    AND (tmdb_id IS NOT NULL OR imdb_id IS NOT NULL)
  )`

/** A request MDBList did not answer. Never stamped as "no data". */
export class MDBListRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'MDBListRequestError'
  }
}

/**
 * Read a batch POST's body into its items. MDBList has answered with an
 * array and with an object keyed by id; anything else is not an answer and
 * throws, so the batch is retried rather than recorded as "nothing found".
 * Info pages (`website`/`documentation` keys) are dropped.
 */
export function readBatchItems<T extends object>(data: unknown): T[] {
  let items: unknown[]
  if (Array.isArray(data)) {
    items = data
  } else if (typeof data === 'object' && data !== null) {
    items = Object.values(data)
  } else {
    throw new MDBListRequestError(`Unexpected MDBList batch response (${typeof data})`)
  }
  return items.filter(
    (item): item is T =>
      typeof item === 'object' && item !== null && !('website' in item) && !('documentation' in item)
  )
}

/**
 * One entry per provider. MDBList lists a provider once per way of watching
 * (rent, buy, subscription), so "Apple TV Store" arrived twice and was drawn
 * twice. First occurrence wins; entries without a name are dropped.
 */
export function dedupeStreamingProviders<P extends { id: number; name: string }>(
  providers: readonly P[]
): Array<{ id: number; name: string }> {
  const seen = new Set<number | string>()
  const out: Array<{ id: number; name: string }> = []
  for (const p of providers) {
    if (!p || !p.name) continue
    const key = p.id ?? p.name
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: p.id, name: p.name.trim() })
  }
  return out
}
