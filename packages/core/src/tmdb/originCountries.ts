import { canonicalCountry } from '../countries/canonical.js'

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
 *
 * This is the ONE copy. Migration 0201 does not repeat it: it sends bad rows
 * back to be asked again, so they are written through this table.
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

/**
 * What TMDb's `origin_country` says, in three cases a writer must treat
 * differently:
 *
 * - `missing`: the response had no such field. Says nothing about the title.
 * - `unresolved`: TMDb named codes and NONE resolves to a canonical name. Not
 *   an answer either: storing it as "names none" would retire the title for
 *   good, and a mapping added later could never reach it. The backfill records
 *   the attempt and asks again after its retry window.
 * - `names`: the resolvable countries, in TMDb's order. `[]` only when TMDb's
 *   own list was empty, which IS an answer.
 *
 * A partially resolvable list keeps what resolves: the unknown code could only
 * have been one more origin, and the known one already matches.
 */
export type OriginAnswer =
  | { kind: 'missing' }
  | { kind: 'unresolved' }
  | { kind: 'names'; names: string[] }

export function readOriginCountries(details: { origin_country?: readonly string[] | null }): OriginAnswer {
  if (!Array.isArray(details.origin_country)) return { kind: 'missing' }
  const names: string[] = []
  let codes = 0
  for (const raw of details.origin_country) {
    if (typeof raw !== 'string') continue
    // The canonicaliser resolves a two-letter code only in upper case.
    const code = raw.trim().toUpperCase()
    if (!code) continue
    codes++
    const name = TMDB_ORIGIN_CODE_NAMES[code] ?? canonicalCountry(code)
    if (name && !names.includes(name)) names.push(name)
  }
  if (codes > 0 && names.length === 0) return { kind: 'unresolved' }
  return { kind: 'names', names }
}

/**
 * TMDb's `origin_country` as canonical country names (the spelling
 * `production_countries` uses, so the two compare directly), or null when the
 * response is not an answer (`missing` or `unresolved` above). Null makes the
 * enrichment writers leave the row pending; the backfill then decides.
 */
export function originCountryNames(details: { origin_country?: readonly string[] | null }): string[] | null {
  const answer = readOriginCountries(details)
  return answer.kind === 'names' ? answer.names : null
}
