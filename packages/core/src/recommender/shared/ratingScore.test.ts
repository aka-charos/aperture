import assert from 'node:assert/strict'
import { test } from 'node:test'

import { calculateRatingScore, ratingFromScore } from './scoring.js'

/** What a run stores: NUMERIC(6, 4). */
function stored(score: number): number {
  return Math.round(score * 10_000) / 10_000
}

test('ratingFromScore undoes calculateRatingScore across every band', () => {
  for (let tenths = 0; tenths <= 100; tenths++) {
    const rating = tenths / 10
    assert.ok(
      Math.abs(ratingFromScore(calculateRatingScore(rating)) - rating) < 1e-9,
      `rating ${rating}`
    )
  }
})

test('a score read back from storage lands within a hundredth of the rating', () => {
  // The precision the insights panel relies on: 4 stored decimals, and the
  // flattest band (above 8) at 0.1 per point.
  for (const rating of [0.3, 4.97, 5.0, 6.8, 6.94, 7.52, 8.0, 8.73, 9.99]) {
    assert.ok(Math.abs(ratingFromScore(stored(calculateRatingScore(rating))) - rating) < 0.01, `rating ${rating}`)
  }
})

test('the live case: 0.56 was a 6.8', () => {
  assert.ok(Math.abs(ratingFromScore(0.56) - 6.8) < 1e-9)
})

test('out-of-range scores clamp to the ends of the scale', () => {
  assert.equal(ratingFromScore(-0.2), 0)
  assert.equal(ratingFromScore(1.4), 10)
})

test('the neutral default reads back as 6, which callers must disambiguate', () => {
  assert.equal(calculateRatingScore(null), 0.4)
  assert.equal(ratingFromScore(0.4), 6)
})
