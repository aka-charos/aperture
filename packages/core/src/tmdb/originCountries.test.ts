import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalCountryNames } from '../countries/canonical.js'
import { TMDB_ORIGIN_CODE_NAMES, originCountryNames } from './originCountries.js'

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

test('an unresolvable code is dropped, so it cannot replace the first-production-country fallback', () => {
  assert.deepEqual(originCountryNames({ origin_country: ['ZZ'] }), [])
  assert.deepEqual(originCountryNames({ origin_country: ['ZZ', 'GR'] }), ['Greece'])
})

test('an empty list is an answer; a missing field is not, so the title stays pending', () => {
  assert.deepEqual(originCountryNames({ origin_country: [] }), [])
  assert.equal(originCountryNames({}), null)
  assert.equal(originCountryNames({ origin_country: null }), null)
})

test('duplicates fold', () => {
  assert.deepEqual(originCountryNames({ origin_country: ['GB', 'gb'] }), ['United Kingdom'])
})
