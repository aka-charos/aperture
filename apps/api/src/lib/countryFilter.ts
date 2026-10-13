/**
 * The Browse country filter, one predicate for both list routes.
 *
 * `production_countries` lists every co-producer, so "Greek" by bare membership
 * includes a French film where Greece is the third of four countries. The
 * filter therefore has a SCOPE:
 *
 * - `primary` matches the country a title is FROM. That is TMDb's
 *   `origin_country` (`origin_countries`, 0200) when enrichment has fetched it,
 *   and the first-listed production country otherwise. The fallback is only
 *   that: measured on a live library, roughly one multi-country title in four
 *   or five has its production countries in A-Z order, where "first" is just
 *   the alphabetically earliest.
 * - `any` matches any production country or origin country, so it is always a
 *   superset of `primary` and ticking it can never hide a title.
 *
 * And a MATCH for several countries: `any` (OR) or `all` (AND).
 *
 * Absent parameters keep the pre-existing behaviour (`any` scope, `all` match)
 * for API callers that never heard of either; the Browse page sends both
 * explicitly, and its own defaults are primary + OR.
 *
 * Pure so the combinations are pinned by a test. Column names are bare, as the
 * list queries read the unaliased table.
 */

export type CountryScope = 'primary' | 'any'
export type CountryMatch = 'all' | 'any'

/**
 * The countries a title is FROM: its TMDb origin when known, else its first
 * production country. `cardinality(NULL)` is NULL, so a never-fetched row takes
 * the ELSE branch exactly as a fetched-but-empty one does.
 */
export const PRIMARY_COUNTRIES_SQL =
  'CASE WHEN cardinality(origin_countries) > 0 THEN origin_countries ELSE production_countries[1:1] END'

/** Every country a title is associated with: co-producers plus origin. */
export const ALL_COUNTRIES_SQL = "(production_countries || COALESCE(origin_countries, '{}'::text[]))"

export function parseCountryQuery(country: string | string[] | undefined): string[] {
  if (!country) return []
  const raw = Array.isArray(country) ? country : country.split(',')
  return [...new Set(raw.map((c) => c.trim()).filter(Boolean))]
}

/**
 * The WHERE fragment for the selected countries, or null when none are
 * selected. `bind` registers a value and returns its placeholder.
 *
 * Primary + AND reads "from one of these and associated with all of them": a
 * title is usually from one country, so requiring its origin to contain every
 * selection would match almost nothing.
 */
export function countryFilterSql(
  countries: readonly string[],
  match: CountryMatch | undefined,
  scope: CountryScope | undefined,
  bind: (value: unknown) => string
): string | null {
  if (countries.length === 0) return null
  const list = `${bind([...countries])}::text[]`
  const all = match !== 'any'

  if (scope === 'primary') {
    const primary = `(${PRIMARY_COUNTRIES_SQL}) && ${list}`
    return all && countries.length > 1 ? `((${primary}) AND ${ALL_COUNTRIES_SQL} @> ${list})` : primary
  }
  return `${ALL_COUNTRIES_SQL} ${all ? '@>' : '&&'} ${list}`
}
