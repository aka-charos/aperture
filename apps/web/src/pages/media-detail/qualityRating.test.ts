import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headlineRating } from './qualityRating'

const SHARES = { audience: 60, critics: 40 }

test('a film with critics reads as combined, with the shares the server sent', () => {
  assert.deepEqual(
    headlineRating({
      quality_rating: 7.12,
      quality_rating_sources: ['imdb', 'metacritic', 'rt'],
      quality_rating_shares: SHARES,
      community_rating: null,
    }),
    { value: 7.12, basis: 'combined', audience: 'imdb', critics: ['metacritic', 'rt'], shares: SHARES }
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
  assert.equal(headlineRating({ quality_rating: 8, quality_rating_sources: ['imdb'], community_rating: 8 })?.basis, 'audience')
  assert.equal(headlineRating({ quality_rating: 6, quality_rating_sources: ['metacritic'], community_rating: null })?.basis, 'critics')
})

test('a number with no source this build knows is unknown, never "critics"', () => {
  const h = headlineRating({ quality_rating: 7, quality_rating_sources: [], community_rating: null })
  assert.equal(h?.basis, 'unknown')
  assert.equal(h?.audience, null)
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
    shares: null,
  })
  assert.equal(headlineRating({ community_rating: null }), null)
})
