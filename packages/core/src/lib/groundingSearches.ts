/**
 * How many Google searches one grounded Gemini response ran.
 *
 * Gemini decides per request how many searches to issue and reports them in
 * `providerMetadata.google.groundingMetadata.webSearchQueries`. The usage meter
 * (`web_search_usage.search_queries`, 0206) records the count, because some
 * paid plans bill grounding per search, and one request can be four searches
 * or eight.
 *
 * Only call this on a response that ARRIVED: absent metadata on a completed
 * response means Gemini chose not to search, which is a real 0. A call that
 * never got a response has no count at all, and its row stays NULL rather than
 * claiming zero — the caller simply does not report one.
 *
 * Pure, so the grounding sources and the meter cannot read the field two ways.
 */
export function groundingSearchCount(providerMetadata: unknown): number {
  const google = (providerMetadata as { google?: unknown } | null | undefined)?.google
  const grounding = (google as { groundingMetadata?: unknown } | null | undefined)?.groundingMetadata
  const queries = (grounding as { webSearchQueries?: unknown } | null | undefined)?.webSearchQueries
  return Array.isArray(queries) ? queries.length : 0
}
