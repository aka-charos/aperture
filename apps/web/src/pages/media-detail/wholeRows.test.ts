import test from 'node:test'
import assert from 'node:assert/strict'
import { trackCount, wholeRowCount } from './wholeRows'

test('a list ends on its last full row', () => {
  assert.equal(wholeRowCount(12, 5), 10)
  assert.equal(wholeRowCount(12, 7), 7)
  assert.equal(wholeRowCount(12, 4), 12)
  assert.equal(wholeRowCount(12, 2), 12)
})

test('a list shorter than one row is drawn whole', () => {
  assert.equal(wholeRowCount(3, 5), 3)
  assert.equal(wholeRowCount(5, 5), 5)
  assert.equal(wholeRowCount(0, 4), 0)
})

test('an unknown column count draws the whole list', () => {
  assert.equal(wholeRowCount(12, 0), 12)
  assert.equal(wholeRowCount(12, Number.NaN), 12)
})

test('tracks are counted only from a laid-out grid', () => {
  assert.equal(trackCount('140px 140px 140.5px'), 3)
  assert.equal(trackCount(' 130px '), 1)
  assert.equal(trackCount('repeat(auto-fill, minmax(130px, 1fr))'), 0)
  assert.equal(trackCount('none'), 0)
  assert.equal(trackCount(''), 0)
})
