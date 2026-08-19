/**
 * One name per country, for a column that holds several of them.
 *
 * `production_countries` is written by three paths that do not agree on a
 * vocabulary. Jellyfin and Emby pass `ProductionLocations` straight through
 * from whatever the server's scraper wrote into the NFO, so the value carries
 * the scraper's locale and formatting; OMDb enrichment writes English names
 * split on commas. `COALESCE` means whichever ran last wins, and the library
 * ends up holding all of them at once. A count over one real library:
 *
 *   United States of America 3670 | United States 1020 | USA 1018 | US 12
 *   United Kingdom 1025 | UK 218 | GB 1
 *   Ελλάδα 254 while "Greece" sits separately at 22
 *   bare ISO codes: IT, FR, GB, GR, CO, PS, RS
 *   "France, Belgium, Canada, United Kingdom, Latvia, United States" as ONE
 *   array entry, because that path never split on commas
 *
 * That is 11% of country mentions provably non-canonical before counting the
 * long-form US duplicates, which no simple test can even see. It is not only a
 * display problem: the assistant filters with
 * `production_countries::text ILIKE '%France%'`, which misses every title
 * filed as `Γαλλία` or `FR`, and the list endpoint uses exact array overlap,
 * so filtering on "United States of America" misses the 2,050 titles spelled
 * three other ways.
 *
 * The rule that makes this safe to run over data nobody has read: **an
 * unrecognised value passes through untouched.** This maps what it knows and
 * refuses to guess, so a country that only ever appears in the middle of an
 * array — a place no survey here has looked — cannot be damaged by it.
 *
 * Historic states keep their own names rather than folding into successors.
 * A 1985 film made in West Germany was not made in Germany, and Soviet cinema
 * is not Russian cinema; for a film library those are facts about the work,
 * not spellings to clean up. They carry no ISO code, because no current flag
 * set has one.
 */

interface Country {
  /** The single spelling everything else maps to. */
  name: string
  /** ISO 3166-1 alpha-2, or null for states that no longer exist. */
  code: string | null
  /**
   * Every other spelling seen or expected, lowercased. Two-letter codes are
   * NOT listed here — they resolve through `code` and only when the stored
   * value is upper case. See `lookup`.
   */
  aliases?: string[]
}

const COUNTRIES: Country[] = [
  { name: 'United States', code: 'US', aliases: ['united states of america', 'usa', 'u.s.a.', 'u.s.', 'america'] },
  { name: 'United Kingdom', code: 'GB', aliases: ['uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'] },
  { name: 'France', code: 'FR', aliases: ['γαλλία'] },
  { name: 'Italy', code: 'IT', aliases: ['ιταλία'] },
  { name: 'Germany', code: 'DE', aliases: ['γερμανία'] },
  { name: 'Canada', code: 'CA', aliases: ['καναδάς'] },
  { name: 'Japan', code: 'JP', aliases: ['ιαπωνία'] },
  { name: 'Spain', code: 'ES', aliases: ['ισπανία'] },
  { name: 'Greece', code: 'GR', aliases: ['ελλάδα', 'hellas'] },
  { name: 'South Korea', code: 'KR', aliases: ['korea, south', 'korea (south)', 'republic of korea', 'νότια κορέα'] },
  { name: 'North Korea', code: 'KP', aliases: ['korea, north', 'korea (north)', "democratic people's republic of korea"] },
  { name: 'Australia', code: 'AU', aliases: ['αυστραλία'] },
  { name: 'Russia', code: 'RU', aliases: ['russian federation', 'ρωσία'] },
  { name: 'China', code: 'CN', aliases: ["people's republic of china", 'κίνα'] },
  { name: 'Sweden', code: 'SE', aliases: ['σουηδία'] },
  { name: 'Hungary', code: 'HU', aliases: ['ουγγαρία'] },
  { name: 'Hong Kong', code: 'HK', aliases: ['hong kong sar china', 'hong kong sar', 'χονγκ κονγκ'] },
  { name: 'Belgium', code: 'BE', aliases: ['βέλγιο'] },
  { name: 'Denmark', code: 'DK', aliases: ['δανία'] },
  { name: 'Poland', code: 'PL', aliases: ['πολωνία'] },
  { name: 'Mexico', code: 'MX', aliases: ['μεξικό'] },
  { name: 'Argentina', code: 'AR', aliases: ['αργεντινή'] },
  { name: 'Brazil', code: 'BR', aliases: ['βραζιλία'] },
  { name: 'Norway', code: 'NO', aliases: ['νορβηγία'] },
  { name: 'Ireland', code: 'IE', aliases: ['ιρλανδία'] },
  { name: 'Netherlands', code: 'NL', aliases: ['the netherlands', 'holland', 'ολλανδία'] },
  { name: 'India', code: 'IN', aliases: ['ινδία'] },
  { name: 'Finland', code: 'FI', aliases: ['φινλανδία'] },
  { name: 'Turkey', code: 'TR', aliases: ['türkiye', 'turkiye', 'τουρκία'] },
  { name: 'Austria', code: 'AT', aliases: ['αυστρία'] },
  { name: 'Israel', code: 'IL', aliases: ['ισραήλ'] },
  { name: 'Iran', code: 'IR', aliases: ['iran, islamic republic of', 'islamic republic of iran', 'ιράν'] },
  { name: 'South Africa', code: 'ZA', aliases: ['νότια αφρική'] },
  { name: 'New Zealand', code: 'NZ', aliases: ['νέα ζηλανδία'] },
  { name: 'Thailand', code: 'TH', aliases: ['ταϊλάνδη'] },
  { name: 'Czech Republic', code: 'CZ', aliases: ['czechia', 'τσεχία'] },
  { name: 'Romania', code: 'RO', aliases: ['ρουμανία'] },
  { name: 'Iceland', code: 'IS', aliases: ['ισλανδία'] },
  { name: 'Serbia', code: 'RS', aliases: ['σερβία'] },
  { name: 'Switzerland', code: 'CH', aliases: ['ελβετία'] },
  { name: 'Chile', code: 'CL', aliases: ['χιλή'] },
  { name: 'Taiwan', code: 'TW', aliases: ['taiwan, province of china', 'ταϊβάν'] },
  { name: 'Indonesia', code: 'ID', aliases: ['ινδονησία'] },
  { name: 'Bulgaria', code: 'BG', aliases: ['βουλγαρία'] },
  { name: 'Portugal', code: 'PT', aliases: ['πορτογαλία'] },
  { name: 'Colombia', code: 'CO', aliases: ['κολομβία'] },
  { name: 'Nigeria', code: 'NG', aliases: ['νιγηρία'] },
  { name: 'Luxembourg', code: 'LU', aliases: ['λουξεμβούργο'] },
  { name: 'Egypt', code: 'EG', aliases: ['αίγυπτος'] },
  { name: 'Croatia', code: 'HR', aliases: ['κροατία'] },
  { name: 'Ukraine', code: 'UA', aliases: ['ουκρανία'] },
  { name: 'Morocco', code: 'MA', aliases: ['μαρόκο'] },
  { name: 'Venezuela', code: 'VE', aliases: ['βενεζουέλα'] },
  { name: 'Georgia', code: 'GE', aliases: ['γεωργία'] },
  { name: 'Kazakhstan', code: 'KZ', aliases: ['καζακστάν'] },
  { name: 'Cuba', code: 'CU', aliases: ['κούβα'] },
  { name: 'Philippines', code: 'PH', aliases: ['the philippines', 'φιλιππίνες'] },
  { name: 'Uruguay', code: 'UY', aliases: ['ουρουγουάη'] },
  { name: 'United Arab Emirates', code: 'AE', aliases: ['uae', 'ηνωμένα αραβικά εμιράτα'] },
  { name: 'Tunisia', code: 'TN', aliases: ['τυνησία'] },
  { name: 'Singapore', code: 'SG', aliases: ['σιγκαπούρη'] },
  { name: 'Lithuania', code: 'LT', aliases: ['λιθουανία'] },
  { name: 'Latvia', code: 'LV', aliases: ['λετονία'] },
  { name: 'Cyprus', code: 'CY', aliases: ['κύπρος'] },
  { name: 'Belarus', code: 'BY', aliases: ['λευκορωσία'] },
  { name: 'Albania', code: 'AL', aliases: ['αλβανία'] },
  { name: 'Slovenia', code: 'SI', aliases: ['σλοβενία'] },
  { name: 'Slovakia', code: 'SK', aliases: ['σλοβακία'] },
  { name: 'Estonia', code: 'EE', aliases: ['εσθονία'] },
  { name: 'Peru', code: 'PE', aliases: ['περού'] },
  { name: 'Pakistan', code: 'PK', aliases: ['πακιστάν'] },
  { name: 'Lebanon', code: 'LB', aliases: ['λίβανος'] },
  { name: 'Bosnia and Herzegovina', code: 'BA', aliases: ['bosnia & herzegovina', 'bosnia', 'βοσνία - ερζεγοβίνη', 'βοσνία-ερζεγοβίνη', 'βοσνία και ερζεγοβίνη'] },
  { name: 'Vietnam', code: 'VN', aliases: ['viet nam', 'βιετνάμ'] },
  { name: 'Puerto Rico', code: 'PR', aliases: ['πουέρτο ρίκο'] },
  { name: 'Cambodia', code: 'KH', aliases: ['καμπότζη'] },
  { name: 'Bhutan', code: 'BT', aliases: ['μπουτάν'] },
  { name: 'Ghana', code: 'GH', aliases: ['γκάνα'] },
  { name: 'Qatar', code: 'QA', aliases: ['κατάρ'] },
  { name: 'Armenia', code: 'AM', aliases: ['αρμενία'] },
  { name: 'Rwanda', code: 'RW', aliases: ['ρουάντα'] },
  { name: 'Bahamas', code: 'BS', aliases: ['the bahamas', 'μπαχάμες'] },
  { name: 'Senegal', code: 'SN', aliases: ['σενεγάλη'] },
  { name: 'Jamaica', code: 'JM', aliases: ['τζαμάικα'] },
  { name: 'Iraq', code: 'IQ', aliases: ['ιράκ'] },
  { name: 'Algeria', code: 'DZ', aliases: ['αλγερία'] },
  { name: 'Saudi Arabia', code: 'SA', aliases: ['σαουδική αραβία'] },
  { name: 'Guatemala', code: 'GT', aliases: ['γουατεμάλα'] },
  { name: 'Bolivia', code: 'BO', aliases: ['βολιβία'] },
  { name: 'Jordan', code: 'JO', aliases: ['ιορδανία'] },
  { name: 'Uganda', code: 'UG', aliases: ['ουγκάντα'] },
  { name: 'Malawi', code: 'MW', aliases: ['μαλάουι'] },
  { name: 'Libya', code: 'LY', aliases: ['λιβύη'] },
  { name: 'Paraguay', code: 'PY', aliases: ['παραγουάη'] },
  // Three spellings of one place. "Occupied Palestinian Territory" is the UN
  // statistical label and PS is the ISO code; the name is Palestine.
  { name: 'Palestine', code: 'PS', aliases: ['occupied palestinian territory', 'palestinian territory', 'state of palestine', 'παλαιστίνη'] },

  // Gone, and deliberately kept. Spelling variants still collapse — "USSR"
  // and "Soviet Union" are the same state — but the state itself does not
  // collapse into whatever stands there now.
  { name: 'Soviet Union', code: null, aliases: ['ussr', 'u.s.s.r.', 'union of soviet socialist republics', 'σοβιετική ένωση'] },
  { name: 'West Germany', code: null, aliases: ['frg', 'δυτική γερμανία'] },
  { name: 'East Germany', code: null, aliases: ['german democratic republic', 'gdr', 'ανατολική γερμανία'] },
  { name: 'Yugoslavia', code: null, aliases: ['socialist federal republic of yugoslavia', 'sfr yugoslavia', 'γιουγκοσλαβία'] },
  { name: 'Federal Republic of Yugoslavia', code: null },
  { name: 'Serbia and Montenegro', code: null, aliases: ['serbia & montenegro'] },
  { name: 'Czechoslovakia', code: null, aliases: ['τσεχοσλοβακία'] },
]

const BY_ALIAS = new Map<string, string>()
const BY_CODE = new Map<string, string>()
const CODE_OF = new Map<string, string | null>()

for (const country of COUNTRIES) {
  BY_ALIAS.set(country.name.toLowerCase(), country.name)
  CODE_OF.set(country.name, country.code)
  if (country.code) BY_CODE.set(country.code, country.name)
  for (const alias of country.aliases ?? []) BY_ALIAS.set(alias, country.name)
}

/** Trim, and collapse the runs of whitespace that split values leave behind. */
function tidy(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * The canonical name for one written form, or null if we do not know it.
 *
 * Two-letter values resolve only when they are upper case in the stored data.
 * Lower case is how a word gets in by accident — "no", "in", "is" and "it"
 * are all country codes and all English words, and a `production_countries`
 * entry of "No" should stay "No" rather than silently becoming Norway.
 */
export function canonicalCountry(value: string): string | null {
  const tidied = tidy(value)
  if (!tidied) return null
  if (tidied.length === 2) {
    if (tidied !== tidied.toUpperCase()) return null
    // Codes first, then aliases: "UK" is written constantly and is not the
    // United Kingdom's ISO code, which is GB.
    return BY_CODE.get(tidied) ?? BY_ALIAS.get(tidied.toLowerCase()) ?? null
  }
  return BY_ALIAS.get(tidied.toLowerCase()) ?? null
}

/** ISO 3166-1 alpha-2 for a canonical name; null for historic states. */
export function countryCode(name: string): string | null {
  return CODE_OF.get(name) ?? null
}

/**
 * One stored entry, as the list of countries it actually names.
 *
 * The split is guarded: a comma-joined entry only comes apart when EVERY part
 * is a country we recognise. That is what keeps a legitimate name containing a
 * comma — "Korea, South", "Iran, Islamic Republic of", "Taiwan, Province of
 * China" — from being shredded into two values that mean nothing, which is
 * exactly the bug that put "Ancient (to 1453)" in the languages column.
 */
function splitEntry(value: string): string[] {
  if (!value.includes(',')) return [value]
  const parts = value.split(',').map(tidy).filter(Boolean)
  if (parts.length < 2) return [value]
  return parts.every((part) => canonicalCountry(part) !== null) ? parts : [value]
}

/**
 * A stored country array, normalised: split where safe, mapped where known,
 * passed through where not, and de-duplicated — because collapsing spellings
 * is what creates duplicates in the first place. `["USA", "United States"]`
 * is one country written twice.
 *
 * Order is preserved. The first entry is the one the detail page shows, so
 * re-ordering here would silently change what a reader sees a film as.
 */
export function normalizeCountries(
  values: readonly string[] | null | undefined
): string[] {
  const out: string[] = []
  for (const value of values ?? []) {
    for (const part of splitEntry(value)) {
      const name = canonicalCountry(part) ?? tidy(part)
      if (name && !out.includes(name)) out.push(name)
    }
  }
  return out
}

/** Every canonical name, for callers that need the vocabulary itself. */
export function canonicalCountryNames(): string[] {
  return COUNTRIES.map((country) => country.name)
}
