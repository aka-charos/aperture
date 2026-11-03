import { test } from 'node:test'
import assert from 'node:assert/strict'
import { printsSameRating, qualityBasis, qualityBasisField, qualityRatingFields } from './qualityRating.js'

const SHARES = { audience: 60, critics: 40 }

test('a computed title sends its stored number and sources', () => {
  // NUMERIC arrives from pg as text.
  assert.deepEqual(
    qualityRatingFields({ quality_rating: '7.12', quality_rating_sources: ['imdb', 'metacritic', 'rt'], community_rating: null }),
    { quality_rating: 7.12, quality_rating_sources: ['imdb', 'metacritic', 'rt'], quality_rating_shares: SHARES }
  )
})

test('a title not computed yet sends the media server rating, named as such', () => {
  assert.deepEqual(qualityRatingFields({ quality_rating: null, quality_rating_sources: null, community_rating: '7.60' }), {
    quality_rating: 7.6,
    quality_rating_sources: ['mediaServer'],
    quality_rating_shares: SHARES,
  })
})

test('a computed title nothing rates sends no rating, never the fallback', () => {
  assert.deepEqual(qualityRatingFields({ quality_rating: null, quality_rating_sources: [], community_rating: 7 }), {
    quality_rating: null,
    quality_rating_sources: [],
    quality_rating_shares: SHARES,
  })
})

test('a row without the columns (schema behind the image) reads as not computed', () => {
  assert.deepEqual(qualityRatingFields({ community_rating: 8 }).quality_rating_sources, ['mediaServer'])
})

const SIX_NINE = { quality_rating: '6.94', quality_rating_sources: ['imdb', 'rt'], community_rating: '6.8' }

test('quality basis: a recorded rating the headline still shows is current', () => {
  assert.deepEqual(qualityBasis('0.5880', '6.94', SIX_NINE), { current: true, rating: 6.94, scoredRating: null })
})

test('quality basis: a recorded rating that prints the same is current, not stale', () => {
  // The review's case: an unrounded 6.9437 under a stored 6.94 must not read
  // "scored on 6.9; the rating is now 6.9".
  assert.deepEqual(qualityBasis('0.5887', '6.9437', SIX_NINE), { current: true, rating: 6.94, scoredRating: null })
})

test('quality basis: a recorded rating that differs is named, even if the curve has moved', () => {
  // The recorded rating wins over the score: a score from a retuned curve
  // would read back as something else.
  assert.deepEqual(qualityBasis('0.9999', '6.8', SIX_NINE), { current: false, rating: 6.94, scoredRating: 6.8 })
})

test('quality basis: a recorded rating with the title unrated now is stale', () => {
  assert.deepEqual(qualityBasis('0.5600', '6.8', { quality_rating: null, quality_rating_sources: [], community_rating: null }), {
    current: false,
    rating: null,
    scoredRating: 6.8,
  })
})

test('quality basis: an older row is read back through the curve (the live case)', () => {
  // Scored on the media server's 6.8 before the rating was recorded.
  assert.deepEqual(qualityBasis('0.5600', null, SIX_NINE), { current: false, rating: 6.94, scoredRating: 6.8 })
})

test('quality basis: an older row whose read-back prints the same is current', () => {
  // 0.5887 reads back as 6.9435: the same 6.9 the headline shows.
  assert.deepEqual(qualityBasis('0.5887', null, SIX_NINE), { current: true, rating: 6.94, scoredRating: null })
})

test('quality basis: an older row matching the current score exactly is current', () => {
  assert.deepEqual(qualityBasis('0.5880', null, SIX_NINE), { current: true, rating: 6.94, scoredRating: null })
})

test('quality basis: a title still uncomputed is read on its media server rating', () => {
  assert.deepEqual(qualityBasis(0.56, null, { quality_rating: null, quality_rating_sources: null, community_rating: '6.8' }), {
    current: true,
    rating: 6.8,
    scoredRating: null,
  })
})

test('quality basis: the neutral default never names a number it cannot know', () => {
  // 0.4 is both a 6.0 and an unrated title; unrated now, it is current.
  assert.deepEqual(qualityBasis('0.4000', null, { quality_rating: null, quality_rating_sources: [], community_rating: null }), {
    current: true,
    rating: null,
    scoredRating: null,
  })
  // Rated now, so 0.4 is out of date, but it may have been "unrated" or "6.0".
  assert.deepEqual(qualityBasis('0.4000', null, { quality_rating: '7.10', quality_rating_sources: ['imdb'], community_rating: '7.1' }), {
    current: false,
    rating: 7.1,
    scoredRating: null,
  })
})

test('quality basis: no stored score, no basis; no title row, no field', () => {
  assert.equal(qualityBasis(null, '7.1', SIX_NINE), null)
  assert.deepEqual(qualityBasisField({ rating_score: '0.5880', scored_rating: '6.94' }, null), {})
  assert.deepEqual(qualityBasisField({ rating_score: '0.5880', scored_rating: '6.94' }, SIX_NINE), {
    qualityBasis: { current: true, rating: 6.94, scoredRating: null },
  })
})

test('printsSameRating compares at the one decimal the headline prints', () => {
  assert.equal(printsSameRating(6.9437, 6.94), true)
  assert.equal(printsSameRating(6.8, 6.94), false)
  assert.equal(printsSameRating(7, 7.04), true)
})
