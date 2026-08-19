/**
 * Pins the real mess, not an imagined one: every case below is a value
 * counted in a live library's `production_countries` column.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalCountry,
  canonicalCountryNames,
  countryCode,
  normalizeCountries,
} from './canonical.js'

describe('collapsing spellings of one country', () => {
  test('the four ways the United States is stored', () => {
    for (const written of ['United States of America', 'United States', 'USA', 'US']) {
      assert.equal(canonicalCountry(written), 'United States')
    }
  })

  test('the three ways the United Kingdom is stored', () => {
    for (const written of ['United Kingdom', 'UK', 'GB']) {
      assert.equal(canonicalCountry(written), 'United Kingdom')
    }
  })

  test('an array holding two spellings of one country yields one', () => {
    assert.deepEqual(
      normalizeCountries(['United States of America', 'USA', 'United States']),
      ['United States']
    )
  })

  test('Czechia and Czech Republic are the same country', () => {
    assert.equal(canonicalCountry('Czechia'), 'Czech Republic')
    assert.equal(canonicalCountry('Czech Republic'), 'Czech Republic')
  })

  test('Türkiye and Turkey are the same country', () => {
    assert.equal(canonicalCountry('Türkiye'), 'Turkey')
    assert.equal(canonicalCountry('Turkey'), 'Turkey')
  })

  test('Hong Kong SAR China is Hong Kong', () => {
    assert.equal(canonicalCountry('Hong Kong SAR China'), 'Hong Kong')
  })
})

describe('the media server locale leak', () => {
  test('Greek names resolve to the same country as their English spelling', () => {
    const pairs: Array<[string, string]> = [
      ['Ελλάδα', 'Greece'],
      ['Γερμανία', 'Germany'],
      ['Γαλλία', 'France'],
      ['Βέλγιο', 'Belgium'],
      ['Κύπρος', 'Cyprus'],
      ['Βουλγαρία', 'Bulgaria'],
      ['Καναδάς', 'Canada'],
      ['Τουρκία', 'Turkey'],
      ['Αλβανία', 'Albania'],
      ['Τσεχία', 'Czech Republic'],
      ['Αργεντινή', 'Argentina'],
      ['Ρωσία', 'Russia'],
      ['Φινλανδία', 'Finland'],
      ['Βοσνία - Ερζεγοβίνη', 'Bosnia and Herzegovina'],
    ]
    for (const [greek, english] of pairs) {
      assert.equal(canonicalCountry(greek), english, greek)
    }
  })

  test('the 254 titles filed as Ελλάδα join the 22 filed as Greece', () => {
    assert.deepEqual(normalizeCountries(['Ελλάδα', 'Greece']), ['Greece'])
  })
})

describe('bare ISO codes', () => {
  test('the codes actually found in the column', () => {
    assert.equal(canonicalCountry('IT'), 'Italy')
    assert.equal(canonicalCountry('FR'), 'France')
    assert.equal(canonicalCountry('GR'), 'Greece')
    assert.equal(canonicalCountry('CO'), 'Colombia')
    assert.equal(canonicalCountry('RS'), 'Serbia')
  })

  test('lower case is a word, not a code', () => {
    // "no", "in", "is" and "it" are all country codes AND English words. A
    // value that is not upper case was never meant as a code.
    assert.equal(canonicalCountry('no'), null)
    assert.equal(canonicalCountry('in'), null)
    assert.equal(canonicalCountry('it'), null)
    assert.deepEqual(normalizeCountries(['No']), ['No'])
  })
})

describe('entries that never got split', () => {
  test('a whole co-production list stored as one value comes apart', () => {
    assert.deepEqual(
      normalizeCountries([
        'France, Belgium, Canada, United Kingdom, Latvia, United States',
      ]),
      ['France', 'Belgium', 'Canada', 'United Kingdom', 'Latvia', 'United States']
    )
  })

  test('splitting normalises each part on the way through', () => {
    assert.deepEqual(normalizeCountries(['United Kingdom, United States']), [
      'United Kingdom',
      'United States',
    ])
  })

  test('a country name containing a comma is left whole', () => {
    // The languages column shows what the alternative costs: splitting
    // blindly turned "Greek, Ancient (to 1453)" into a language called
    // "Ancient (to 1453)".
    assert.equal(canonicalCountry('Korea, South'), 'South Korea')
    assert.deepEqual(normalizeCountries(['Korea, South']), ['South Korea'])
    assert.deepEqual(normalizeCountries(['Iran, Islamic Republic of']), ['Iran'])
    assert.deepEqual(normalizeCountries(['Taiwan, Province of China']), ['Taiwan'])
  })

  test('a partly-unknown comma value is not split apart', () => {
    assert.deepEqual(normalizeCountries(['France, Somewhere Else']), [
      'France, Somewhere Else',
    ])
  })
})

describe('states that no longer exist', () => {
  test('are kept, not folded into their successors', () => {
    for (const historic of [
      'Soviet Union',
      'West Germany',
      'East Germany',
      'Yugoslavia',
      'Czechoslovakia',
      'Serbia and Montenegro',
      'Federal Republic of Yugoslavia',
    ]) {
      assert.equal(canonicalCountry(historic), historic)
    }
    assert.notEqual(canonicalCountry('West Germany'), 'Germany')
    assert.notEqual(canonicalCountry('Soviet Union'), 'Russia')
  })

  test('their own spelling variants still collapse', () => {
    assert.equal(canonicalCountry('USSR'), 'Soviet Union')
    assert.equal(canonicalCountry('German Democratic Republic'), 'East Germany')
  })

  test('they carry no flag code', () => {
    assert.equal(countryCode('Soviet Union'), null)
    assert.equal(countryCode('West Germany'), null)
    assert.equal(countryCode('Germany'), 'DE')
  })
})

describe('refusing to guess', () => {
  test('an unknown country passes through unchanged', () => {
    assert.equal(canonicalCountry('Wakanda'), null)
    assert.deepEqual(normalizeCountries(['Wakanda']), ['Wakanda'])
  })

  test('an unknown value keeps its place among known ones', () => {
    assert.deepEqual(normalizeCountries(['USA', 'Wakanda', 'Ελλάδα']), [
      'United States',
      'Wakanda',
      'Greece',
    ])
  })

  test('an unknown value is not invented into a neighbour', () => {
    assert.deepEqual(normalizeCountries(['Wakanda', 'Genovia']), [
      'Wakanda',
      'Genovia',
    ])
  })
})

describe('one place, one name', () => {
  test('the UN label and the ISO code both resolve to Palestine', () => {
    assert.equal(canonicalCountry('Occupied Palestinian Territory'), 'Palestine')
    assert.equal(canonicalCountry('PS'), 'Palestine')
    assert.equal(canonicalCountry('Palestine'), 'Palestine')
    assert.equal(countryCode('Palestine'), 'PS')
  })

  test('the three stored spellings collapse to one', () => {
    assert.deepEqual(
      normalizeCountries(['Occupied Palestinian Territory', 'Palestine', 'PS']),
      ['Palestine']
    )
  })
})

describe('housekeeping', () => {
  test('order is preserved, because the first entry is what the page shows', () => {
    assert.deepEqual(normalizeCountries(['Denmark', 'Germany', 'Netherlands']), [
      'Denmark',
      'Germany',
      'Netherlands',
    ])
  })

  test('whitespace is tidied', () => {
    assert.equal(canonicalCountry('  United   States  '), 'United States')
    assert.deepEqual(normalizeCountries(['  France  ']), ['France'])
  })

  test('empty and missing input', () => {
    assert.deepEqual(normalizeCountries(null), [])
    assert.deepEqual(normalizeCountries(undefined), [])
    assert.deepEqual(normalizeCountries([]), [])
    assert.deepEqual(normalizeCountries(['', '   ']), [])
    assert.equal(canonicalCountry(''), null)
  })

  test('case does not matter for names', () => {
    assert.equal(canonicalCountry('france'), 'France')
    assert.equal(canonicalCountry('SOUTH KOREA'), 'South Korea')
  })
})

describe('the table itself', () => {
  const names = canonicalCountryNames()

  test('every canonical name resolves to itself', () => {
    // A name that does not round-trip is a name the normaliser would rewrite
    // on a second pass, which the backfill would do every time it ran.
    for (const name of names) assert.equal(canonicalCountry(name), name, name)
  })

  test('no country is listed twice', () => {
    assert.deepEqual(names.length, new Set(names).size)
  })

  test('no two countries share an ISO code', () => {
    // A duplicated code is silent until it becomes a flag, and then one
    // country wears another's.
    const codes = names.map(countryCode).filter((code): code is string => code !== null)
    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const name of names) {
      const code = countryCode(name)
      if (code === null) continue
      const previous = seen.get(code)
      if (previous) collisions.push(`${code}: ${previous} + ${name}`)
      else seen.set(code, name)
    }
    assert.deepEqual(collisions, [])
    assert.equal(codes.length, seen.size)
  })

  test('every code is two upper-case letters', () => {
    for (const name of names) {
      const code = countryCode(name)
      if (code === null) continue
      assert.match(code, /^[A-Z]{2}$/, `${name} -> ${code}`)
    }
  })

  test('normalising twice changes nothing', () => {
    // The backfill is re-runnable by design, so this is the property that
    // makes running it a second time safe.
    const messy = [
      'USA',
      'Ελλάδα',
      'France, Belgium, Canada, United Kingdom, Latvia, United States',
      'Wakanda',
      'West Germany',
      'PS',
    ]
    const once = normalizeCountries(messy)
    assert.deepEqual(normalizeCountries(once), once)
  })
})

describe('the long tail the full survey turned up', () => {
  test('the second wave of Greek names', () => {
    const pairs: Array<[string, string]> = [
      ['Ιταλία', 'Italy'],
      ['Ηνωμένο Βασίλειο', 'United Kingdom'],
      ['Ηνωμένες Πολιτείες', 'United States'],
      ['Κάτω Χώρες', 'Netherlands'],
      ['Ελβετία', 'Switzerland'],
      ['Ρουμανία', 'Romania'],
      ['Βόρεια Μακεδονία', 'North Macedonia'],
      ['Πολωνία', 'Poland'],
      ['Ουγγαρία', 'Hungary'],
      ['Σλοβενία', 'Slovenia'],
      ['Ισπανία', 'Spain'],
      ['Ισραήλ', 'Israel'],
      ['Κροατία', 'Croatia'],
      ['Νορβηγία', 'Norway'],
    ]
    for (const [greek, english] of pairs) {
      assert.equal(canonicalCountry(greek), english, greek)
    }
  })

  test('Palestinian Territories is the same place again', () => {
    assert.equal(canonicalCountry('Palestinian Territories'), 'Palestine')
  })

  test('countries that appear once each still resolve', () => {
    for (const name of [
      'Malta',
      'Liechtenstein',
      'Kosovo',
      'Montenegro',
      'Macao',
      'Vanuatu',
      'Antarctica',
      "Côte d'Ivoire",
      'Cayman Islands',
    ]) {
      assert.equal(canonicalCountry(name), name, name)
    }
  })

  test('the codes the column actually contains', () => {
    const pairs: Array<[string, string]> = [
      ['QA', 'Qatar'],
      ['SA', 'Saudi Arabia'],
      ['SE', 'Sweden'],
      ['JO', 'Jordan'],
      ['FI', 'Finland'],
      ['DK', 'Denmark'],
      ['DE', 'Germany'],
      ['AU', 'Australia'],
      ['NO', 'Norway'],
    ]
    for (const [code, name] of pairs) assert.equal(canonicalCountry(code), name, code)
  })
})

describe('NA is not a country', () => {
  test('the code is refused, the name is not', () => {
    // A scraper writing "NA" means "not applicable" — turning that into an
    // African country is worse than leaving it alone.
    assert.equal(canonicalCountry('NA'), null)
    assert.deepEqual(normalizeCountries(['NA']), ['NA'])
    assert.equal(canonicalCountry('Namibia'), 'Namibia')
  })

  test('Namibia still carries its code for flags', () => {
    assert.equal(countryCode('Namibia'), 'NA')
  })
})
