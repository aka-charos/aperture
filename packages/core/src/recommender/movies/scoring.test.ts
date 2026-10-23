import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FALLBACK_CONFIG, type Candidate } from '../types.js'
import { calculateRatingScore } from '../shared/index.js'
import { scoreCandidates } from './scoring.js'

function candidate(id: string, communityRating: number | null): Candidate {
  return {
    movieId: id,
    id,
    title: `Movie ${id}`,
    year: 2020,
    genres: [],
    communityRating,
    voteCount: null,
    similarity: 0.5,
    normalizedSimilarity: 0,
    novelty: 0,
    ratingScore: 0,
    diversityScore: 0,
    diversityBoost: 0,
    finalScore: 0,
  }
}

test('the rating scored is the unified one, not the media server copy', () => {
  // Media server says 9.3 (stale), the unified rating says 7.5 (F-167).
  const { candidates } = scoreCandidates([candidate('a', 9.3)], new Map(), FALLBACK_CONFIG, new Map([['a', 7.5]]))
  assert.equal(candidates[0].ratingScore, calculateRatingScore(7.5))
  // The media server's number stays on the candidate for the acclaimed gate.
  assert.equal(candidates[0].communityRating, 9.3)
})

test('a film the map lacks scores on the media server rating', () => {
  const { candidates } = scoreCandidates([candidate('new', 6.4)], new Map(), FALLBACK_CONFIG, new Map())
  assert.equal(candidates[0].ratingScore, calculateRatingScore(6.4))
})

test('a film no source rates gets the neutral score, not a zero', () => {
  const { candidates } = scoreCandidates([candidate('none', 8)], new Map(), FALLBACK_CONFIG, new Map([['none', null]]))
  assert.equal(candidates[0].ratingScore, calculateRatingScore(null))
})
