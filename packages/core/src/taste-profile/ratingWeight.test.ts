import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateEngagementWeight } from './builder.js'
import { isDislikedRating, DISLIKED_RATING_MAX, LIKED_RATING_MIN } from '../recommender/ratingBands.js'

// A movie item with everything else held neutral, so only the rating moves.
const item = (rating?: number) => ({
  id: 'm1',
  title: 'T',
  playCount: 1,
  hasFavorites: false,
  lastPlayedAt: null,
  rating,
  genres: [] as string[],
  collectionName: undefined,
})

const w = (rating?: number) => calculateEngagementWeight(item(rating), 'movie')

test('a disliked title contributes nothing at all', () => {
  // It used to enter at 0.65 here (and 0.2 on the legacy path), pulling the
  // centroid toward the thing the viewer said they disliked.
  for (let r = 1; r <= DISLIKED_RATING_MAX; r++) {
    assert.equal(w(r), 0, `rating ${r}`)
  }
})

test('the curve is monotonic across the whole scale', () => {
  // The broken version peaked at 5/10 and dropped at 6, because it tried to
  // detect a 1-5 scale that user_ratings' CHECK constraint rules out.
  const weights = []
  for (let r = DISLIKED_RATING_MAX + 1; r <= 10; r++) weights.push(w(r))
  for (let i = 1; i < weights.length; i++) {
    assert.ok(weights[i] > weights[i - 1], `rating ${i + DISLIKED_RATING_MAX + 1} not above previous`)
  }
})

test('5 out of 10 no longer ties with 10 out of 10', () => {
  assert.ok(w(10) > w(5), `${w(10)} should beat ${w(5)}`)
  assert.ok(w(9) > w(5), 'a 9 must outweigh a 5')
  assert.ok(w(6) > w(4), 'a 6 must outweigh a 4')
})

test('an unrated title is unaffected', () => {
  assert.equal(w(undefined), 1)
})

test('the top of the scale keeps its documented ceiling', () => {
  assert.equal(w(10).toFixed(4), '1.2500')
})

test('the band helper agrees with the bands', () => {
  assert.equal(isDislikedRating(DISLIKED_RATING_MAX), true)
  assert.equal(isDislikedRating(DISLIKED_RATING_MAX + 1), false)
  assert.equal(isDislikedRating(LIKED_RATING_MIN), false)
  // Absent is not disliked -- most titles carry no explicit rating at all.
  assert.equal(isDislikedRating(undefined), false)
  assert.equal(isDislikedRating(null), false)
  assert.equal(isDislikedRating(NaN), false)
})
