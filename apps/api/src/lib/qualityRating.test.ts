import { test } from 'node:test'
import assert from 'node:assert/strict'
import { qualityBasis, qualityRatingFields } from './qualityRating.js'

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

test('quality basis: a score the current rating gives is current', () => {
  // 6.94 scores 0.588 on the curve; pg sends NUMERIC as text.
  assert.deepEqual(
    qualityBasis('0.5880', { quality_rating: '6.94', quality_rating_sources: ['imdb', 'rt'], community_rating: '6.8' }),
    { current: true, rating: 6.94, scoredRating: null }
  )
})

test('quality basis: an older run names the rating it was scored on (the live case)', () => {
  // Scored on the media server's 6.8 before the unified rating existed.
  assert.deepEqual(
    qualityBasis('0.5600', { quality_rating: '6.94', quality_rating_sources: ['imdb', 'rt'], community_rating: '6.8' }),
    { current: false, rating: 6.94, scoredRating: 6.8 }
  )
})

test('quality basis: a title still uncomputed is read on its media server rating', () => {
  assert.deepEqual(
    qualityBasis(0.56, { quality_rating: null, quality_rating_sources: null, community_rating: '6.8' }),
    { current: true, rating: 6.8, scoredRating: null }
  )
})

test('quality basis: the neutral default never names a number it cannot know', () => {
  // 0.4 is both a 6.0 and an unrated title; unrated now, it is current.
  assert.deepEqual(
    qualityBasis('0.4000', { quality_rating: null, quality_rating_sources: [], community_rating: null }),
    { current: true, rating: null, scoredRating: null }
  )
  // Rated now, so 0.4 is out of date, but it may have been "unrated" or "6.0".
  assert.deepEqual(
    qualityBasis('0.4000', { quality_rating: '7.10', quality_rating_sources: ['imdb'], community_rating: '7.1' }),
    { current: false, rating: 7.1, scoredRating: null }
  )
})

test('quality basis: no stored score, no basis', () => {
  assert.equal(qualityBasis(null, { quality_rating: '7.1', quality_rating_sources: ['imdb'], community_rating: null }), null)
})
