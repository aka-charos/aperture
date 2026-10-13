/**
 * The Browse country filter, one predicate for both list routes.
 *
 * `production_countries` lists every co-producer, so "Greek" by bare membership
 * includes a French film where Greece is the third of four countries. The
 * filter therefore has a SCOPE: `primary` matches only the country listed
 * first, which is the closest thing the metadata has to the country a title
 * belongs to; `any` is membership anywhere in the list, the old behaviour.
 * "First" is the order the media server stores, which mirrors its metadata
 * source; nothing here re-orders it.
 *
 * And a MATCH for several countries: `any` (OR) or `all` (AND).
 *
 * Absent parameters keep the pre-existing behaviour (`any` scope, `all` match),
 * so an API caller that never heard of either gets the answers it always got;
 * the Browse page sends both explicitly, and its own defaults are primary + OR.
 *
 * Pure so the four combinations are pinned by a test. Column names are bare,
 * as the list queries read the unaliased table.
 */

export type CountryScope = 'primary' | 'any'
export type CountryMatch = 'all' | 'any'

export function parseCountryQuery(country: string | string[] | undefined): string[] {
  if (!country) return []
  const raw = Array.isArray(country) ? country : country.split(',')
  return [...new Set(raw.map((c) => c.trim()).filter(Boolean))]
}

/**
 * The WHERE fragment for the selected countries, or null when none are
 * selected. `bind` registers a value and returns its placeholder.
 *
 * Primary + AND reads "led by one of these and co-produced by all of them":
 * a title has one primary country, so requiring it to equal every selection
 * could never match more than one country.
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
    const primary = `production_countries[1] = ANY(${list})`
    return all && countries.length > 1 ? `(${primary} AND production_countries @> ${list})` : primary
  }
  return `production_countries ${all ? '@>' : '&&'} ${list}`
}
