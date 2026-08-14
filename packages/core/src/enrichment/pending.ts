/**
 * Which rows still need an enrichment pass.
 *
 * Split out of index.ts so it can be tested without a database, the same way
 * watchedExclusion.ts carries the watched/favorited predicates.
 */

/** A row is enrichable if at least one source can be asked about it. */
const ENRICHABLE_ID_SQL = {
  movies: '(imdb_id IS NOT NULL OR tmdb_id IS NOT NULL)',
  series: '(imdb_id IS NOT NULL OR tmdb_id IS NOT NULL OR tvdb_id IS NOT NULL)',
} as const

/**
 * The one definition of "this row still needs an enrichment pass".
 *
 * It lived in four places — two counts and two selections — and they agreed
 * only because all four were wrong in the same way, which is precisely why the
 * OMDb gap stayed invisible: the progress counter said nothing was pending and
 * the selection returned nothing, consistently and in agreement.
 *
 * The third clause is the fix. `enrichment_version` records which schema
 * version was current when a row was touched, not which sources answered, so a
 * library enriched before OMDb was configured is stamped complete forever and
 * adding the key later does nothing at all.
 *
 * It is conditional on OMDb actually being usable, and that guard is
 * load-bearing in the other direction: with OMDb off, nothing can ever satisfy
 * the clause, so every row would stay permanently pending and each pass would
 * re-run TMDb over the whole library without the job ever reaching "nothing to
 * do".
 */
export function needsEnrichmentSql(
  table: 'movies' | 'series',
  versionParam: string,
  omdbEnabled: boolean
): string {
  const stale = ['enriched_at IS NULL', `COALESCE(enrichment_version, 0) < ${versionParam}`]
  if (omdbEnabled) stale.push('(omdb_enriched_at IS NULL AND imdb_id IS NOT NULL)')
  return `(${stale.join(' OR ')})\n       AND ${ENRICHABLE_ID_SQL[table]}`
}
