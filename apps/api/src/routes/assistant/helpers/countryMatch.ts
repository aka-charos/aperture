/**
 * A library row stores production countries as country *names* — "France",
 * "Japan", "South Korea" — but a viewer asks for national cinema with the
 * adjective: "French films", "Korean thrillers", "a Japanese horror". The
 * search filter is `production_countries::text ILIKE '%<value>%'`, and
 * "French" is not a substring of "France", so the natural phrasing matched
 * nothing at all while 1,688 French films sat in the library.
 *
 * The prompt can ask the model to say "France", and it often does — but a rule
 * that has to win against the user's own wording every single turn is not a
 * fix. Normalising here means both spellings work whatever the model emits.
 *
 * Values are chosen to be substrings of every stored variant rather than exact
 * names, which is what makes one entry cover several: "United States" matches
 * "United States of America", "Germany" matches "West Germany", and "Czech"
 * matches Czech Republic, Czechia and Czechoslovakia alike.
 *
 * Unknown input passes through untouched, so a plain country name still works
 * and an unlisted nationality degrades to today's behaviour rather than to an
 * error.
 */
import { canonicalCountry } from '@aperture/core/countries'

export const DEMONYM_TO_COUNTRY: Record<string, string> = {
  // Europe
  french: 'France',
  german: 'Germany',
  // Both of these named the wrong thing. "West German" resolved to "Germany",
  // which as a substring returns every German film ever made rather than the
  // 50 made in the FRG; "East German" resolved to "German Democratic
  // Republic", a string that appears nowhere in the column — the library
  // stores "East Germany" — so it matched nothing at all.
  'west german': 'West Germany',
  'east german': 'East Germany',
  italian: 'Italy',
  spanish: 'Spain',
  portuguese: 'Portugal',
  british: 'United Kingdom',
  english: 'United Kingdom',
  scottish: 'United Kingdom',
  welsh: 'United Kingdom',
  uk: 'United Kingdom',
  britain: 'United Kingdom',
  irish: 'Ireland',
  dutch: 'Netherlands',
  holland: 'Netherlands',
  belgian: 'Belgium',
  swiss: 'Switzerland',
  austrian: 'Austria',
  swedish: 'Sweden',
  danish: 'Denmark',
  norwegian: 'Norway',
  finnish: 'Finland',
  icelandic: 'Iceland',
  polish: 'Poland',
  czech: 'Czech',
  slovak: 'Slovakia',
  hungarian: 'Hungary',
  romanian: 'Romania',
  bulgarian: 'Bulgaria',
  greek: 'Greece',
  serbian: 'Serbia',
  croatian: 'Croatia',
  bosnian: 'Bosnia',
  slovenian: 'Slovenia',
  albanian: 'Albania',
  estonian: 'Estonia',
  latvian: 'Latvia',
  lithuanian: 'Lithuania',
  russian: 'Russia',
  soviet: 'Soviet Union',
  ukrainian: 'Ukraine',
  belarusian: 'Belarus',
  georgian: 'Georgia',
  armenian: 'Armenia',
  yugoslav: 'Yugoslavia',

  // Americas
  american: 'United States',
  usa: 'United States',
  us: 'United States',
  canadian: 'Canada',
  mexican: 'Mexico',
  brazilian: 'Brazil',
  argentine: 'Argentina',
  argentinian: 'Argentina',
  chilean: 'Chile',
  colombian: 'Colombia',
  peruvian: 'Peru',
  uruguayan: 'Uruguay',
  venezuelan: 'Venezuela',
  bolivian: 'Bolivia',
  cuban: 'Cuba',
  haitian: 'Haiti',
  jamaican: 'Jamaica',

  // Asia
  japanese: 'Japan',
  korean: 'South Korea',
  'south korean': 'South Korea',
  'north korean': 'North Korea',
  chinese: 'China',
  'hong kongese': 'Hong Kong',
  taiwanese: 'Taiwan',
  indian: 'India',
  pakistani: 'Pakistan',
  bangladeshi: 'Bangladesh',
  'sri lankan': 'Sri Lanka',
  nepali: 'Nepal',
  thai: 'Thailand',
  vietnamese: 'Vietnam',
  cambodian: 'Cambodia',
  filipino: 'Philippines',
  philippine: 'Philippines',
  indonesian: 'Indonesia',
  malaysian: 'Malaysia',
  singaporean: 'Singapore',
  mongolian: 'Mongolia',
  kazakh: 'Kazakhstan',
  burmese: 'Myanmar',
  bhutanese: 'Bhutan',

  // Middle East and Africa
  turkish: 'Turkey',
  israeli: 'Israel',
  palestinian: 'Palestine',
  iranian: 'Iran',
  persian: 'Iran',
  iraqi: 'Iraq',
  lebanese: 'Lebanon',
  syrian: 'Syria',
  jordanian: 'Jordan',
  saudi: 'Saudi Arabia',
  emirati: 'United Arab Emirates',
  qatari: 'Qatar',
  egyptian: 'Egypt',
  moroccan: 'Morocco',
  algerian: 'Algeria',
  tunisian: 'Tunisia',
  senegalese: 'Senegal',
  malian: 'Mali',
  nigerian: 'Nigeria',
  ghanaian: 'Ghana',
  kenyan: 'Kenya',
  ethiopian: 'Ethiopia',
  'south african': 'South Africa',
  cameroonian: 'Cameroon',

  // Oceania
  australian: 'Australia',
  'new zealand': 'New Zealand',
  kiwi: 'New Zealand',
}

/**
 * Resolve a country filter written as either a nationality or a country name
 * into the form stored in `production_countries`. Whitespace is trimmed and
 * matching is case-insensitive; anything unrecognised is returned as given.
 *
 * Two passes, because there are two ways to be wrong. The table above turns a
 * nationality into a country; the canonical vocabulary then turns whatever
 * name came out — from the table or straight from the user — into the one
 * spelling the column actually holds. That second pass is what lets a filter
 * written as "USA", "Ελλάδα" or "Türkiye" find anything, which matters
 * because the value arrives from a language model that will produce all
 * three.
 *
 * Entries that are deliberately partial survive it. `czech` resolves to
 * "Czech", which is not a country and so is left alone — and that is the
 * point: it is a substring covering Czech Republic, Czechia and
 * Czechoslovakia at once, which no single canonical name can do.
 */
export function normalizeCountryQuery(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return trimmed
  const key = trimmed.toLowerCase().replace(/\s+/g, ' ')
  const resolved = DEMONYM_TO_COUNTRY[key] ?? trimmed
  return canonicalCountry(resolved) ?? resolved
}
