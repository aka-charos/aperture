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
