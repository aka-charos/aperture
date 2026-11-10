import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numericOrNull } from './numeric.js'

test('NUMERIC text reads as a number; NULL and junk stay null, never 0', () => {
  assert.equal(numericOrNull('7.5000'), 7.5)
  assert.equal(numericOrNull('0.0000'), 0)
  assert.equal(numericOrNull(3), 3)
  assert.equal(numericOrNull(null), null)
  assert.equal(numericOrNull(undefined), null)
  assert.equal(numericOrNull('N/A'), null)
  assert.equal(numericOrNull(Number.NaN), null)
})
