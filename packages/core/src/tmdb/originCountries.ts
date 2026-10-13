import { canonicalCountry, canonicalCountryNames } from '../countries/canonical.js'

/**
 * Codes TMDb uses that the canonicaliser deliberately does not resolve.
 *
 * TMDb keeps withdrawn ISO 3166-1 codes for states that no longer exist, and
 * the canonicaliser stores those states with NO code (a 1985 film made in West
 * Germany was not made in Germany, so nothing may fold them into a successor
 * by code). It also refuses `NA` everywhere, since in free text it is far more
 * often "not available" than Namibia. TMDb's field is a code list and nothing
 * else, so here each one means exactly one country. Every target is pinned by
 * a test to be a canonical name, or the mapping would write a spelling that
 * matches nothing.
 */
export const TMDB_ORIGIN_CODE_NAMES: Readonly<Record<string, string>> = {
  SU: 'Soviet Union',
  XC: 'Czechoslovakia',
  YU: 'Yugoslavia',
  XG: 'East Germany',
  CS: 'Serbia and Montenegro',
  NA: 'Namibia',
  BU: 'Myanmar',
}

const CANONICAL = new Set(canonicalCountryNames())

/**
 * TMDb's `origin_country` as canonical country names.
 *
 * TMDb sends ISO 3166-1 alpha-2 codes ("GR", "FR"); `production_countries`
 * holds names ("Greece", "France"), so each code resolves to the canonical
 * spelling and compares directly. Codes are upper-cased first, since the
 * canonicaliser resolves a two-letter code only in upper case.
 *
 * A code that resolves to NO canonical name is DROPPED, unlike every other use
 * of the canonicaliser, which passes unknown values through. Here a raw code
 * cannot match any country the picker offers, and because the Browse filter
 * prefers a non-empty origin over the first production country, one stored
 * "ZR" would silently replace a correct fallback. Dropping it leaves `[]`, and
 * `[]` falls back.
 *
 * Order is kept. A response with NO field returns null, not `[]`: `[]` is
 * stored as "TMDb answered" and a missing field does not say that.
 */
export function originCountryNames(details: { origin_country?: readonly string[] | null }): string[] | null {
  if (!Array.isArray(details.origin_country)) return null
  const names: string[] = []
  for (const raw of details.origin_country) {
    if (typeof raw !== 'string') continue
    const code = raw.trim().toUpperCase()
    if (!code) continue
    const name = TMDB_ORIGIN_CODE_NAMES[code] ?? canonicalCountry(code)
    if (name && CANONICAL.has(name) && !names.includes(name)) names.push(name)
  }
  return names
}
