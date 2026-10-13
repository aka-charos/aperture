import test from 'node:test'
import assert from 'node:assert/strict'
import { originCountryNames } from './originCountries.js'

test("TMDb's codes become the names production_countries uses", () => {
  assert.deepEqual(originCountryNames({ origin_country: ['GR'] }), ['Greece'])
  assert.deepEqual(originCountryNames({ origin_country: ['FR', 'BE'] }), ['France', 'Belgium'])
})

test('lower-case or padded codes still resolve', () => {
  assert.deepEqual(originCountryNames({ origin_country: [' gr '] }), ['Greece'])
})

test('a code the canonicaliser does not know passes through rather than vanishing', () => {
  assert.deepEqual(originCountryNames({ origin_country: ['ZZ'] }), ['ZZ'])
})

test('an empty list is an answer; a missing field is not, so the title stays pending', () => {
  assert.deepEqual(originCountryNames({ origin_country: [] }), [])
  assert.equal(originCountryNames({}), null)
  assert.equal(originCountryNames({ origin_country: null }), null)
})

test('duplicates fold', () => {
  assert.deepEqual(originCountryNames({ origin_country: ['GB', 'gb'] }), ['United Kingdom'])
})
