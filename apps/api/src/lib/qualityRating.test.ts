import { test } from 'node:test'
import assert from 'node:assert/strict'
import { qualityRatingFields } from './qualityRating.js'

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
