import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalCountryNames } from '../countries/canonical.js'
import { TMDB_ORIGIN_CODE_NAMES, originCountryNames, readOriginCountries } from './originCountries.js'

test("TMDb's codes become the names production_countries uses", () => {
  assert.deepEqual(originCountryNames({ origin_country: ['GR'] }), ['Greece'])
  assert.deepEqual(originCountryNames({ origin_country: ['FR', 'BE'] }), ['France', 'Belgium'])
})

test('lower-case or padded codes still resolve', () => {
  assert.deepEqual(originCountryNames({ origin_country: [' gr '] }), ['Greece'])
})

test("TMDb's codes for states that no longer exist resolve to their own names", () => {
  assert.deepEqual(originCountryNames({ origin_country: ['SU'] }), ['Soviet Union'])
  assert.deepEqual(originCountryNames({ origin_country: ['XC'] }), ['Czechoslovakia'])
  assert.deepEqual(originCountryNames({ origin_country: ['YU'] }), ['Yugoslavia'])
  assert.deepEqual(originCountryNames({ origin_country: ['XG'] }), ['East Germany'])
  assert.deepEqual(originCountryNames({ origin_country: ['NA'] }), ['Namibia'])
})

test('every special-cased code maps to a canonical name, or it would match nothing', () => {
  const names = new Set(canonicalCountryNames())
  for (const [code, name] of Object.entries(TMDB_ORIGIN_CODE_NAMES)) {
    assert.ok(names.has(name), `${code} maps to "${name}", which is not a canonical country`)
  }
})

test('codes that resolve to nothing are NOT an answer, so a later mapping can still reach the title', () => {
  assert.deepEqual(readOriginCountries({ origin_country: ['ZZ'] }), { kind: 'unresolved' })
  assert.equal(originCountryNames({ origin_country: ['ZZ'] }), null)
})

test('a partly resolvable list keeps what resolves', () => {
  assert.deepEqual(readOriginCountries({ origin_country: ['ZZ', 'GR'] }), { kind: 'names', names: ['Greece'] })
})

test("an empty list is TMDb's answer; a missing field is not", () => {
  assert.deepEqual(readOriginCountries({ origin_country: [] }), { kind: 'names', names: [] })
  assert.deepEqual(readOriginCountries({}), { kind: 'missing' })
  assert.deepEqual(readOriginCountries({ origin_country: null }), { kind: 'missing' })
  assert.equal(originCountryNames({}), null)
})

test('duplicates fold', () => {
  assert.deepEqual(originCountryNames({ origin_country: ['GB', 'gb'] }), ['United Kingdom'])
})
