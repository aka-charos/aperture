/**
 * The rating a title SHOWS, as SQL: the stored unified rating (F-167), or the
 * media server's own while the title has not been computed yet.
 *
 * Every surface that prints, filters or sorts by a title's rating reads this,
 * so a poster, a Browse row, a search result and the title page carry one
 * number, and it is the number recommendations score on. It is the SQL twin of
 * storedQualityRating (unifiedRating.ts): NULL sources means not computed and
 * falls back to community_rating; computed and unrated is NULL, never the
 * fallback.
 *
 * Callers alias it AS community_rating so the response shapes, and the web
 * bundle reading them, stay as they were: the field has always meant "the
 * rating this title shows". Only the episode rows, the title page's own
 * headline inputs and the measurement readers listed in
 * displayRatingCallSites.test.ts still select the raw column.
 *
 * Pure, pinned by displayRating.test.ts.
 */

const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * `alias` is the table alias the query uses for movies or series (omit it for
 * an unaliased FROM). It is interpolated, so anything but an identifier is
 * refused rather than trusted.
 */
export function displayRatingSql(alias?: string): string {
  if (alias !== undefined && !ALIAS.test(alias)) {
    throw new Error(`displayRatingSql: not a table alias: ${alias}`)
  }
  const a = alias ? `${alias}.` : ''
  return `(CASE WHEN ${a}quality_rating_sources IS NULL THEN ${a}community_rating ELSE ${a}quality_rating END)`
}

const PLACEHOLDER = /^\$[1-9][0-9]*$/

/**
 * `displayRatingSql(alias) >= value`, written so the planner can estimate it.
 *
 * Postgres keeps no statistics on the CASE, so it guesses a third of the table
 * passes whatever the value. On a similarity search that guess is expensive: told
 * plenty of titles fit, it walks the vector index to fill the LIMIT, and when only
 * a handful do it walks all of it (10.8 s against 0.7 s for "rated 8.5 or higher",
 * F-183). The two branches read columns it has statistics for. They select the
 * same rows as the CASE: a NULL fails either way.
 *
 * @param value a query placeholder such as `$4`, used twice; nothing else is taken
 */
export function displayRatingAtLeastSql(alias: string | undefined, value: string): string {
  if (alias !== undefined && !ALIAS.test(alias)) {
    throw new Error(`displayRatingAtLeastSql: not a table alias: ${alias}`)
  }
  if (!PLACEHOLDER.test(value)) {
    throw new Error(`displayRatingAtLeastSql: not a placeholder: ${value}`)
  }
  const a = alias ? `${alias}.` : ''
  return (
    `((${a}quality_rating_sources IS NULL AND ${a}community_rating >= ${value}) ` +
    `OR (${a}quality_rating_sources IS NOT NULL AND ${a}quality_rating >= ${value}))`
  )
}
