import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CUTOFFS,
  dcg,
  historyBucket,
  macroAverage,
  median,
  ndcgAt,
  percentileRank,
  scoreUser,
  weightedRecallAt,
  type RankedHit,
  type UserMetrics,
} from './metrics.js'
import type { GradedItem } from './holdout.js'

const hit = (rank: number, relevance = 1, itemId = `i${rank}`): RankedHit => ({
  itemId,
  rank,
  relevance,
})

// ---------------------------------------------------------------------------
// Percentile
// ---------------------------------------------------------------------------

test('percentile rank runs 1 at the top to 0 at the bottom', () => {
  assert.equal(percentileRank(1, 1000), 1)
  assert.equal(percentileRank(1000, 1000), 0)
  assert.ok(Math.abs(percentileRank(500, 1000) - 0.5) < 0.002)
})

test('percentile rank survives degenerate pools rather than dividing by zero', () => {
  assert.equal(percentileRank(1, 1), 1)
  assert.equal(percentileRank(1, 0), 1)
  assert.equal(percentileRank(Number.NaN, 100), 1)
})

test('a rank outside the pool is clamped, not extrapolated', () => {
  assert.equal(percentileRank(0, 100), 1)
  assert.equal(percentileRank(500, 100), 0)
})

test('median handles both parities and an empty list', () => {
  assert.equal(median([]), 0)
  assert.equal(median([5]), 5)
  assert.equal(median([1, 3]), 2)
  assert.equal(median([3, 1, 2]), 2)
})

// ---------------------------------------------------------------------------
// NDCG
// ---------------------------------------------------------------------------

test('a perfect ranking scores 1 and a worse one scores less', () => {
  const relevances = [1, 1, 0.5]
  const perfect = [hit(1, 1), hit(2, 1), hit(3, 0.5)]
  const scattered = [hit(1, 0.5), hit(40, 1), hit(90, 1)]

  assert.ok(Math.abs(ndcgAt(perfect, relevances, 100) - 1) < 1e-12)
  assert.ok(ndcgAt(scattered, relevances, 100) < 1)
})

test('putting the strongest signal first beats putting it last', () => {
  const relevances = [1, 0.1]
  const strongFirst = [hit(1, 1), hit(2, 0.1)]
  const strongLast = [hit(1, 0.1), hit(2, 1)]
  assert.ok(ndcgAt(strongFirst, relevances, 20) > ndcgAt(strongLast, relevances, 20))
})

test('nothing inside the cutoff scores 0, and no answers at all scores 0', () => {
  assert.equal(ndcgAt([hit(900)], [1], 20), 0)
  assert.equal(ndcgAt([], [], 20), 0)
  assert.equal(ndcgAt([hit(1)], [0], 20), 0)
})

test('a viewer is not punished for having more answers than the cutoff allows', () => {
  // Ten answers, a cutoff of three: the ideal is the best three, so placing
  // three of them perfectly is a 1.0 rather than a 0.3.
  const relevances = Array(10).fill(1)
  const perfectThree = [hit(1), hit(2), hit(3)]
  assert.ok(Math.abs(ndcgAt(perfectThree, relevances, 3) - 1) < 1e-12)
})

test('dcg discounts by log2 of position', () => {
  assert.equal(dcg([1]), 1)
  assert.ok(Math.abs(dcg([1, 1]) - (1 + 1 / Math.log2(3))) < 1e-12)
})

// ---------------------------------------------------------------------------
// Weighted recall
// ---------------------------------------------------------------------------

test('recall is weighted by relevance, so a rewatch counts for more than a half-watch', () => {
  const relevances = [1, 0.1]
  const strongFound = weightedRecallAt([hit(5, 1)], relevances, 20)
  const weakFound = weightedRecallAt([hit(5, 0.1)], relevances, 20)
  assert.ok(strongFound > weakFound)
  assert.ok(Math.abs(strongFound - 1 / 1.1) < 1e-12)
})

test('recall with no relevance mass is 0 rather than NaN', () => {
  assert.equal(weightedRecallAt([], [], 20), 0)
  assert.equal(weightedRecallAt([hit(1, 0)], [0], 20), 0)
})

// ---------------------------------------------------------------------------
// Scoring one viewer
// ---------------------------------------------------------------------------

test('a held-out title the ranking never returned counts as worst, not as absent', () => {
  // Dropping it would let a configuration score well by retrieving less, which
  // is the one way to game this without improving anything.
  const test: GradedItem[] = [
    { itemId: 'found', relevance: 1 },
    { itemId: 'missing', relevance: 1 },
  ]
  const ranks = new Map([['found', 1]])
  const scored = scoreUser('u1', test, ranks, 1000)

  assert.equal(scored.testItems, 2)
  assert.equal(scored.medianPercentile, 0.5, 'one at the top and one at the floor')
  assert.ok(scored.ndcg[20] < 1)
})

test('every cutoff is reported', () => {
  const scored = scoreUser('u1', [{ itemId: 'a', relevance: 1 }], new Map([['a', 3]]), 500)
  for (const k of DEFAULT_CUTOFFS) {
    assert.ok(typeof scored.ndcg[k] === 'number')
    assert.ok(typeof scored.recall[k] === 'number')
  }
})

// ---------------------------------------------------------------------------
// Aggregation — the one that matters
// ---------------------------------------------------------------------------

test('a heavy viewer does not outvote a sporadic one', () => {
  // The failure this exists to prevent: pooling every held-out title weights
  // each viewer by how much they watch, so the "average" describes heavy users
  // only. One viewer, one vote.
  const heavy: UserMetrics = {
    userId: 'heavy',
    testItems: 200,
    poolSize: 12584,
    medianPercentile: 1,
    ndcg: { 20: 1, 100: 1, 500: 1 },
    recall: { 20: 1, 100: 1, 500: 1 },
  }
  const sparse: UserMetrics = {
    userId: 'sparse',
    testItems: 8,
    poolSize: 12584,
    medianPercentile: 0,
    ndcg: { 20: 0, 100: 0, 500: 0 },
    recall: { 20: 0, 100: 0, 500: 0 },
  }

  const aggregate = macroAverage([heavy, sparse])
  assert.equal(aggregate.medianPercentile, 0.5)
  assert.equal(aggregate.ndcg[20], 0.5)
  assert.equal(aggregate.users, 2)
  assert.equal(aggregate.testItems, 208, 'the total is still reported, just not used as a weight')
})

test('an empty run reports zeroes for every cutoff rather than undefined', () => {
  const aggregate = macroAverage([])
  assert.equal(aggregate.users, 0)
  for (const k of DEFAULT_CUTOFFS) {
    assert.equal(aggregate.ndcg[k], 0)
    assert.equal(aggregate.recall[k], 0)
  }
})

test('history buckets split at the stated sizes', () => {
  assert.equal(historyBucket(0), '<100')
  assert.equal(historyBucket(99), '<100')
  assert.equal(historyBucket(100), '100-500')
  assert.equal(historyBucket(499), '100-500')
  assert.equal(historyBucket(500), '500+')
  assert.equal(historyBucket(9000), '500+')
})
