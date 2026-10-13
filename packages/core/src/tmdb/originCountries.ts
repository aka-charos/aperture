import { normalizeCountries } from '../countries/canonical.js'

/**
 * TMDb's `origin_country` as canonical country names.
 *
 * TMDb sends ISO 3166-1 alpha-2 codes ("GR", "FR"); `production_countries`
 * holds names ("Greece", "France"), so the codes go through the same
 * canonicaliser to land in the same vocabulary and compare directly. That
 * canonicaliser resolves a two-letter code only in upper case, so the codes are
 * upper-cased first; a code it does not know passes through unchanged, as
 * everywhere else it is used.
 *
 * Order is kept: TMDb lists a single-origin title's one country, and a joint
 * origin in its own order.
 *
 * A response with NO field returns null, not `[]`: `[]` is stored as "TMDb
 * names no origin" and never asked again, which a missing field does not say.
 */
export function originCountryNames(details: { origin_country?: readonly string[] | null }): string[] | null {
  if (!Array.isArray(details.origin_country)) return null
  const codes = details.origin_country
    .map((code) => (typeof code === 'string' ? code.trim().toUpperCase() : ''))
    .filter((code) => code.length > 0)
  return normalizeCountries(codes)
}
