import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  RT_MC_MAX_DISAGREEMENT,
  UNIFIED_RATING_WEIGHTS,
  computeUnifiedRatings,
  midrankPercentiles,
  presentMean,
  trustedRtScore,
  valueAtPercentile,
  type UnifiedRatingInput,
} from './unifiedRating.js'

function row(id: string, fields: Partial<UnifiedRatingInput>): UnifiedRatingInput {
  return { id, imdb: null, community: null, tmdb: null, rt: null, metacritic: null, ...fields }
}

/**
 * A library whose IMDb ratings are 5.0 to 9.0 in steps of 1, and whose
 * Metacritic and RT run the same order on their own scales, so a rank-mapped
 * critic score lands exactly on the title's own IMDb figure.
 */
const ALIGNED = [
  row('a', { imdb: 5, metacritic: 20, rt: 10 }),
  row('b', { imdb: 6, metacritic: 40, rt: 30 }),
  row('c', { imdb: 7, metacritic: 60, rt: 50 }),
  row('d', { imdb: 8, metacritic: 80, rt: 70 }),
  row('e', { imdb: 9, metacritic: 90, rt: 90 }),
]

test('the decided weights', () => {
  // F-167: audience 0.6 / critics 0.4, and Metacritic leads RT inside critics.
  assert.deepEqual(UNIFIED_RATING_WEIGHTS, { audience: 0.6, critics: 0.4, metacritic: 0.6, rt: 0.4 })
  assert.equal(RT_MC_MAX_DISAGREEMENT, 50)
})

test('a missing source is left out, never counted as zero', () => {
  assert.equal(presentMean(8, 0.6, null, 0.4), 8)
  assert.equal(presentMean(null, 0.6, 6, 0.4), 6)
  assert.equal(presentMean(null, 0.6, null, 0.4), null)
  assert.ok(Math.abs((presentMean(8, 0.6, 6, 0.4) ?? 0) - 7.2) < 1e-9)
})

test('ties take the middle of their rank range', () => {
  const p = midrankPercentiles([100, 100, 100, 50, 0])
  assert.equal(p.get(0), 0)
  assert.equal(p.get(50), 0.25)
  // Positions 2, 3, 4 of 0..4: the middle is 3, i.e. 0.75 -- not the top.
  assert.equal(p.get(100), 0.75)
  assert.equal(midrankPercentiles([7]).get(7), 0.5)
  assert.equal(midrankPercentiles([]).size, 0)
})

test('a percentile reads the reference by nearest rank', () => {
  const ref = [5, 6, 7, 8, 9]
  assert.equal(valueAtPercentile(ref, 0), 5)
  assert.equal(valueAtPercentile(ref, 0.5), 7)
  assert.equal(valueAtPercentile(ref, 1), 9)
  assert.equal(valueAtPercentile(ref, 1.7), 9)
  assert.equal(valueAtPercentile([], 0.5), null)
})

test('an RT score far from Metacritic is dropped; one with no Metacritic is kept', () => {
  // Guillermo del Toro's Pinocchio: the remake's RT 27 beside its own MC 79.
  assert.equal(trustedRtScore(27, 79), null)
  assert.equal(trustedRtScore(29, 79), 29)
  assert.equal(trustedRtScore(27, null), 27)
  assert.equal(trustedRtScore(null, 79), null)
})

test('critics that agree with the audience leave the rating where it was', () => {
  const ratings = computeUnifiedRatings(ALIGNED, 'movie')
  for (const r of ALIGNED) {
    assert.ok(Math.abs((ratings.get(r.id) ?? 0) - (r.imdb ?? 0)) < 1e-9, r.id)
  }
})

test('critics who rate a title lower than its audience pull it down by their share', () => {
  // Title x: IMDb 9 (the top), Metacritic and RT both at the bottom of their scales.
  const library = [...ALIGNED, row('x', { imdb: 9, metacritic: 10, rt: 5 })]
  const x = computeUnifiedRatings(library, 'movie').get('x') ?? 0
  // Critics map to the bottom of IMDb's distribution (5): 0.6 x 9 + 0.4 x 5.
  assert.ok(Math.abs(x - 7.4) < 1e-9, String(x))
})

test('raw scales never reach the result: everything stays on 0-10', () => {
  const ratings = computeUnifiedRatings([...ALIGNED, row('z', { metacritic: 100, rt: 100 })], 'movie')
  for (const value of ratings.values()) {
    assert.ok(value != null && value >= 0 && value <= 10, String(value))
  }
})

test('series ignore critic scores', () => {
  const library = [...ALIGNED, row('x', { imdb: 9, metacritic: 10, rt: 5 })]
  assert.equal(computeUnifiedRatings(library, 'series').get('x'), 9)
})

test('audience is IMDb, then the media server, then TMDb rank-mapped', () => {
  const library = [
    ...ALIGNED,
    row('imdb-and-community', { imdb: 7, community: 9.3 }),
    row('community-only', { community: 6.4 }),
    // TMDb at the top of the TMDb values maps to the top of IMDb (9).
    row('tmdb-only', { tmdb: 8.8 }),
    row('tmdb-low', { tmdb: 1 }),
    row('nothing', {}),
  ]
  const ratings = computeUnifiedRatings(library, 'series')
  assert.equal(ratings.get('imdb-and-community'), 7)
  assert.equal(ratings.get('community-only'), 6.4)
  assert.equal(ratings.get('tmdb-only'), 9)
  assert.equal(ratings.get('tmdb-low'), 5)
  assert.equal(ratings.get('nothing'), null)
})

test('TMDb does not move a title that has an IMDb rating', () => {
  const library = ALIGNED.map((r) => ({ ...r, tmdb: 10 - (r.imdb ?? 0) }))
  const ratings = computeUnifiedRatings(library, 'series')
  for (const r of library) assert.equal(ratings.get(r.id), r.imdb)
})

test('a dropped RT leaves Metacritic as the whole critic half', () => {
  // y: IMDb 9, Metacritic 20 (maps to 5), RT 95 -- 75 points apart, so RT goes.
  const library = [...ALIGNED, row('y', { imdb: 9, metacritic: 20, rt: 95 })]
  const y = computeUnifiedRatings(library, 'movie').get('y') ?? 0
  // MC 20 ties with title a's 20: midrank of positions 0 and 1 of 0..5 is 0.1,
  // which reads IMDb's sorted [5,6,7,8,9,9] at round(0.5) = index 1 -> 6.
  assert.ok(Math.abs(y - (0.6 * 9 + 0.4 * 6)) < 1e-9, String(y))
})

test('non-finite inputs read as missing', () => {
  const ratings = computeUnifiedRatings([row('n', { imdb: Number.NaN, community: 7 })], 'movie')
  assert.equal(ratings.get('n'), 7)
})
