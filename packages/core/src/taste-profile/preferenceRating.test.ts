import test from 'node:test'
import assert from 'node:assert/strict'

import {
  calculateGenreWeight,
  calculatePreferenceScore,
  type FranchiseStats,
  type GenreStats,
} from './franchise.js'
import type { LibraryGenreCounts } from './genrePreference.js'

/**
 * Both scorers feed applyPreferenceAdjustment, which moves a candidate's final
 * score by a share of its remaining headroom. Both used to normalise a user
 * rating with `avgRating > 5 ? /10 : /5` -- a guess at a 1-5 scale that
 * user_ratings has never had (CHECK 1..10 since migration 0053).
 *
 * The guess produced a discontinuity at exactly 5.0 and an inversion below it,
 * so these pin the property that actually matters: more liked must never score
 * lower than less liked, anywhere on the scale.
 */

const franchise = (avgRating: number | null): FranchiseStats => ({
  franchiseName: 'Test',
  itemsWatched: 2,
  totalEngagement: 2,
  totalInLibrary: 4,
  avgRating,
  hasHighEngagement: false,
})

const library: LibraryGenreCounts = {
  counts: new Map([['Drama', 100]]),
  total: 1000,
}

const genre = (avgRating: number | null): GenreStats => ({
  genre: 'Drama',
  itemsWatched: 20,
  totalEngagement: 20,
  avgRating,
  hasFavorites: false,
})

test('franchise preference rises monotonically across the whole 1-10 scale', () => {
  let previous = -Infinity
  for (let rating = 1; rating <= 10; rating += 0.1) {
    const score = calculatePreferenceScore(franchise(Number(rating.toFixed(1))))
    assert.ok(
      score >= previous - 1e-9,
      `rating ${rating.toFixed(1)} scored ${score}, below the ${previous} of the rating beneath it`
    )
    previous = score
  }
})

test('genre weight rises monotonically across the whole 1-10 scale', () => {
  let previous = -Infinity
  for (let rating = 1; rating <= 10; rating += 0.1) {
    const weight = calculateGenreWeight(genre(Number(rating.toFixed(1))), library, 200)
    assert.ok(
      weight >= previous - 1e-9,
      `rating ${rating.toFixed(1)} weighted ${weight}, below the ${previous} of the rating beneath it`
    )
    previous = weight
  }
})

test('there is no cliff at 5.0 -- the old guess dropped fiftyfold over 0.1', () => {
  const at5 = calculatePreferenceScore(franchise(5))
  const at51 = calculatePreferenceScore(franchise(5.1))
  assert.ok(at51 > at5, 'a 5.1 must outscore a 5.0')
  assert.ok(at51 - at5 < 0.05, `0.1 of rating moved the score by ${at51 - at5}`)
})

test('a flat 5 is neutral and 10 beats it, rather than tying', () => {
  const neutral = calculatePreferenceScore(franchise(5))
  const bare = calculatePreferenceScore(franchise(null))
  assert.equal(neutral, bare, 'a 5/10 average must contribute nothing either way')
  assert.ok(calculatePreferenceScore(franchise(10)) > neutral)
})

test('a disliked average pushes the score down, not up', () => {
  // The old branch gave 3/10 -> 3/5 = 0.6 -> a POSITIVE nudge, on titles the
  // taste vector drops outright (see recommender/ratingBands.ts).
  const disliked = calculatePreferenceScore(franchise(3))
  const bare = calculatePreferenceScore(franchise(null))
  assert.ok(disliked < bare, `a 3/10 average scored ${disliked} against a bare ${bare}`)

  const dislikedGenre = calculateGenreWeight(genre(3), library, 200)
  const bareGenre = calculateGenreWeight(genre(null), library, 200)
  assert.ok(dislikedGenre < bareGenre, `a 3/10 genre weighted ${dislikedGenre} against ${bareGenre}`)
})

test('the rating term stays inside its stated +/-0.3 band', () => {
  const bare = calculatePreferenceScore(franchise(null))
  assert.ok(Math.abs(calculatePreferenceScore(franchise(10)) - bare - 0.3) < 1e-9)
  assert.ok(Math.abs(calculatePreferenceScore(franchise(1)) - bare + 0.24) < 1e-9)
})
