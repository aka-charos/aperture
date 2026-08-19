/**
 * Pins the real mess, not an imagined one: every case below is a value
 * counted in a live library's `production_countries` column.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalCountry,
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
