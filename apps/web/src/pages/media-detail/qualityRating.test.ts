import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headlineRating } from './qualityRating'

test('a film with critics reads as combined', () => {
  assert.deepEqual(
    headlineRating({ quality_rating: 7.12, quality_rating_sources: ['imdb', 'metacritic', 'rt'], community_rating: null }),
    { value: 7.12, basis: 'combined', audience: 'imdb', critics: ['metacritic', 'rt'] }
  )
})

test('the unified number replaces the media server rating', () => {
  // Lost Highway: Emby has none, the unified rating does.
  const h = headlineRating({ quality_rating: 7.1, quality_rating_sources: ['imdb', 'metacritic', 'rt'], community_rating: null })
  assert.equal(h?.value, 7.1)
  // And where Emby has one, it is not what the headline shows.
  assert.equal(headlineRating({ quality_rating: 7.5, quality_rating_sources: ['imdb'], community_rating: 9.3 })?.value, 7.5)
})

test('one half alone says which', () => {
  assert.deepEqual(headlineRating({ quality_rating: 8, quality_rating_sources: ['imdb'], community_rating: 8 }), {
    value: 8,
    basis: 'audience',
    audience: 'imdb',
    critics: [],
  })
  assert.equal(headlineRating({ quality_rating: 6, quality_rating_sources: ['metacritic'], community_rating: null })?.basis, 'critics')
})

test('a rating no source supplies is no headline', () => {
  assert.equal(headlineRating({ quality_rating: null, quality_rating_sources: [], community_rating: 7 }), null)
})

test('an older API without the field keeps the media server headline', () => {
  assert.deepEqual(headlineRating({ community_rating: '7.6' }), {
    value: 7.6,
    basis: 'audience',
    audience: 'mediaServer',
    critics: [],
  })
  assert.equal(headlineRating({ community_rating: null }), null)
})
