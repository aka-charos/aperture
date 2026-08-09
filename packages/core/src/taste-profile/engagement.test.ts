import test from 'node:test'
import assert from 'node:assert/strict'
import { completionMultiplier, calculateEngagementWeight } from './builder.js'
import type { WatchedItem } from './types.js'

/**
 * Whether a user liked a show is inferred, never stated, and completion is the
 * strongest tell we have. These pin the bands and -- more importantly -- the
 * arithmetic that motivated them: sampled shows outnumber finished ones, so a
 * ladder that only ever rewards lets the rejects outvote the favourites.
 */

function series(over: Partial<WatchedItem>): WatchedItem {
  return {
    id: 'x',
    title: 'A Show',
    playCount: 0,
    hasFavorites: false,
    lastPlayedAt: null,
    genres: [],
    ...over,
  }
}

/** Weight of a show watched `episodes` deep out of `total`, nothing else set. */
function weightOf(episodes: number, total: number): number {
  return calculateEngagementWeight(
    series({ episodeCount: episodes, playCount: episodes, completionRate: episodes / total }),
    'series'
  )
}

// ============================================================================
// The bands
// ============================================================================

test('the bands match the agreed ladder', () => {
  assert.equal(completionMultiplier(0.05), 0.25, 'bounced off it')
  assert.equal(completionMultiplier(0.15), 0.4, 'sampled and drifted')
  assert.equal(completionMultiplier(0.35), 1.0, 'neutral')
  assert.equal(completionMultiplier(0.7), 1.2, 'committed')
  assert.equal(completionMultiplier(0.95), 1.5, 'finished')
})

test('the boundaries fall on the generous side', () => {
  // Exactly 10% and exactly 25% must not be treated as the worse band.
  assert.equal(completionMultiplier(0.1), 0.4)
  assert.equal(completionMultiplier(0.25), 1.0)
  assert.equal(completionMultiplier(0.5), 1.0, '50% is neutral, never penalised')
  assert.equal(completionMultiplier(0.9), 1.2)
})

test('a library gap is never punished', () => {
  // Watched season one of five while the rest was missing: 20% of what exists
  // on paper, but 100% of what the server holds. completionRate is computed
  // against the server, so this arrives as 1.0 and earns the finished bonus.
  assert.equal(completionMultiplier(1.0), 1.5)

  // And the mid-range, where someone watched a season and never noticed the
  // next one arrive, stays neutral rather than negative.
  for (const rate of [0.25, 0.3, 0.4, 0.5]) {
    assert.ok(completionMultiplier(rate) >= 1.0, `${rate} must not be a penalty`)
  }
})

test('an unknown completion rate leaves the weight alone', () => {
  assert.equal(completionMultiplier(undefined), 1.0)
})

// ============================================================================
// The arithmetic the ladder exists to fix
// ============================================================================

test('finishing a show now outweighs bouncing off one by roughly 9:1', () => {
  const finished = weightOf(10, 10)
  const bounced = weightOf(2, 60)

  const ratio = finished / bounced
  assert.ok(ratio > 8 && ratio < 11, `expected roughly 9:1, got ${ratio.toFixed(1)}:1`)
})

test('a realistic sampler no longer has their taste decided by rejects', () => {
  // Someone who bailed on 40 shows after two episodes and finished five.
  const rejected = 40 * weightOf(2, 60)
  const loved = 5 * weightOf(10, 10)

  assert.ok(
    loved > rejected,
    `finished shows must carry the profile: loved ${loved.toFixed(1)} vs rejected ${rejected.toFixed(1)}`
  )
})

test('more of a show is always worth at least as much as less of it', () => {
  const total = 40
  let previous = 0
  for (const episodes of [1, 4, 10, 14, 20, 30, 40]) {
    const weight = weightOf(episodes, total)
    assert.ok(
      weight >= previous,
      `watching ${episodes}/${total} scored ${weight.toFixed(2)}, below the previous ${previous.toFixed(2)}`
    )
    previous = weight
  }
})

// ============================================================================
// A flagged show that was never started
// ============================================================================

test('a favorited show with no episodes watched counts, modestly', () => {
  const flagged = calculateEngagementWeight(series({ hasFavorites: true }), 'series')

  assert.equal(flagged, 1.5, 'the favorites bonus alone')
  assert.ok(flagged > weightOf(2, 60), 'ahead of a show they started and dropped')
  assert.ok(flagged < weightOf(10, 10), 'behind a show they actually finished')
})
