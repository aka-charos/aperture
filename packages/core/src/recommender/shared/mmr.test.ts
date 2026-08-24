import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_PENALTY_GAIN,
  MIN_PENALTY_GAIN,
  MMR_MIN_POOL,
  MMR_POOL_PER_SLOT,
  mmrPoolSize,
  pairwiseSimilarities,
  penaltyGain,
  selectWithMmr,
  spreadOfValues,
  type MmrCandidate,
} from './mmr.js'

const candidate = (id: string, finalScore: number, title = id): MmrCandidate => ({
  id,
  title,
  year: 2000,
  finalScore,
})

/** A live-shaped pool: 300 titles spanning 0.905 down to 0.82, in three clusters. */
function livePool(size = 300) {
  const candidates = Array.from({ length: size }, (_, i) =>
    candidate(`c${i}`, 0.905 - (0.085 * i) / (size - 1))
  )
  const clusterOf = (id: string) => Number(id.slice(1)) % 3
  const similarity = (a: string, b: string) => (clusterOf(a) === clusterOf(b) ? 0.72 : 0.61)
  return { candidates, similarity, clusterOf }
}

/** The same shape, but with each cluster occupying a contiguous run of ranks. */
function concentratedPool(size = 300, clusterSize = 50) {
  const candidates = Array.from({ length: size }, (_, i) =>
    candidate(`c${i}`, 0.905 - (0.085 * i) / (size - 1))
  )
  const clusterOf = (id: string) => Math.floor(Number(id.slice(1)) / clusterSize)
  const similarity = (a: string, b: string) => (clusterOf(a) === clusterOf(b) ? 0.72 : 0.61)
  return { candidates, similarity, clusterOf }
}

// ---------------------------------------------------------------------------
// Gain
// ---------------------------------------------------------------------------

test('the gain puts a compressed penalty on the relevance scale', () => {
  // Relevance spans 0.08, redundancy spans 0.11: barely any correction needed.
  assert.ok(Math.abs(penaltyGain(0.08, 0.11) - 0.08 / 0.11) < 1e-12)
})

test('an unmeasurable spread yields no correction rather than infinity', () => {
  assert.equal(penaltyGain(0.08, 0), 1)
  assert.equal(penaltyGain(0, 0.1), 1)
  assert.equal(penaltyGain(Number.NaN, 0.1), 1)
  assert.equal(penaltyGain(0.08, Number.NaN), 1)
})

test('the gain is clamped in both directions', () => {
  assert.equal(penaltyGain(1, 1e-9), MAX_PENALTY_GAIN)
  assert.equal(penaltyGain(1e-9, 1), MIN_PENALTY_GAIN)
})

test('spread is p90 minus p10, and survives an empty or non-finite list', () => {
  assert.equal(spreadOfValues([]), 0)
  assert.equal(spreadOfValues([Number.NaN, Number.POSITIVE_INFINITY]), 0)
  assert.equal(spreadOfValues([1, 1, 1]), 0)
  assert.ok(spreadOfValues(Array.from({ length: 11 }, (_, i) => i / 10)) > 0.7)
})

test('the shortlist has a floor and grows with the list length', () => {
  assert.equal(mmrPoolSize(1), MMR_MIN_POOL, 'a short list still gets room to move')
  assert.equal(mmrPoolSize(100), 100 * MMR_POOL_PER_SLOT)
  assert.ok(mmrPoolSize(100) > mmrPoolSize(20))
})

test('pairwise similarities cover every unordered pair once', () => {
  const values = pairwiseSimilarities(['a', 'b', 'c'], () => 0.5)
  assert.equal(values.length, 3)
})

// ---------------------------------------------------------------------------
// The regression this whole module exists for
// ---------------------------------------------------------------------------

test('a 20% diversity weight does not overturn the ranking', () => {
  // The measured failure: with relevance spanning 0.08 across the top 200 and
  // the old diversity term spanning a full 0 to 1, any title within 0.25 of the
  // leader could take a slot outright — thousands of them. Diversity is meant
  // to reorder good matches, not import distant ones.
  const { candidates, similarity } = livePool()
  const { selected } = selectWithMmr(candidates, 16, 0.2, similarity)

  const positions = selected.map((s) => Number(s.id.slice(1)))
  assert.equal(positions[0], 0, 'the best match must still lead the list')
  assert.ok(
    Math.max(...positions) < 60,
    `diversity reached rank ${Math.max(...positions)} of 300 for a 20% weight`
  )
})

test('a candidate outside the shortlist can never be selected', () => {
  // The old selector walked the entire scored pool at every step, which is how
  // a rank-3000 title could win a slot.
  const candidates = [
    ...Array.from({ length: MMR_MIN_POOL }, (_, i) => candidate(`in${i}`, 0.9 - i * 0.0001)),
    candidate('outsider', 0.5),
  ]
  const { selected } = selectWithMmr(candidates, 10, 0.9, () => 0.99)
  assert.ok(!selected.some((s) => s.id === 'outsider'))
})

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

test('zero diversity weight reproduces the plain ranking exactly', () => {
  const { candidates, similarity } = livePool(40)
  const { selected } = selectWithMmr(candidates, 10, 0, similarity)
  assert.deepEqual(
    selected.map((s) => s.id),
    candidates.slice(0, 10).map((c) => c.id)
  )
})

test('raising the weight makes the list less redundant', () => {
  // Clusters concentrated by rank rather than interleaved: the top 50 are all
  // alike, so the plain ranking produces a redundant list and there is
  // something for diversity to actually fix. With interleaved clusters the
  // ranking is already varied and both weights land in the same place, which
  // measures nothing.
  const { candidates, similarity } = concentratedPool()

  const meanRedundancy = (weight: number) => {
    const { selected } = selectWithMmr(candidates, 12, weight, similarity)
    let total = 0
    let pairs = 0
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        total += similarity(selected[i].id, selected[j].id)
        pairs++
      }
    }
    return pairs === 0 ? 0 : total / pairs
  }

  assert.ok(meanRedundancy(0.4) < meanRedundancy(0))
})

test('a near-duplicate of the leader is demoted, a different title is not', () => {
  const candidates = [
    candidate('leader', 0.90),
    candidate('clone', 0.89),
    candidate('other', 0.88),
  ]
  const similarity = (a: string, b: string) => {
    const pair = [a, b].sort().join('|')
    if (pair === 'clone|leader') return 0.98
    return 0.30
  }

  const { selected } = selectWithMmr(candidates, 2, 0.5, similarity)
  assert.deepEqual(
    selected.map((s) => s.id),
    ['leader', 'other']
  )
})

test('two versions of the same film cannot both be selected', () => {
  const candidates = [
    { id: 'a', title: 'Solaris', year: 1972, finalScore: 0.9 },
    { id: 'b', title: 'solaris', year: 1972, finalScore: 0.89 },
    { id: 'c', title: 'Stalker', year: 1979, finalScore: 0.5 },
  ]
  const { selected } = selectWithMmr(candidates, 2, 0.1, () => 0.3)
  assert.deepEqual(
    selected.map((s) => s.id),
    ['a', 'c']
  )
})

test('a candidate with no similarity data competes on relevance alone', () => {
  // A missing embedding must not silently drop a title out of the running.
  const candidates = [candidate('known', 0.80), candidate('unknown', 0.95)]
  const similarity = (a: string, b: string) => (a === 'unknown' || b === 'unknown' ? 0 : 0.9)

  const { selected } = selectWithMmr(candidates, 1, 0.5, similarity)
  assert.equal(selected[0].id, 'unknown')
})

test('variety is measured against the finished list, so the leader is not a free 1.0', () => {
  const { candidates, similarity } = livePool(60)
  const { selected, variety } = selectWithMmr(candidates, 8, 0.3, similarity)

  const leader = variety.get(selected[0].id)
  assert.ok(leader !== undefined)
  assert.ok(
    leader! < 1,
    'scored incrementally the top pick would read 1.0 every time, having had nothing to differ from'
  )
  for (const value of variety.values()) {
    assert.ok(value >= 0 && value <= 1)
  }
})

test('selection ranks are dense, 1-based and match the returned order', () => {
  const { candidates, similarity } = livePool(40)
  const { selected, selectedRanks } = selectWithMmr(candidates, 6, 0.25, similarity)

  assert.equal(selected.length, 6)
  selected.forEach((item, i) => assert.equal(selectedRanks.get(item.id), i + 1))
})

test('asking for more than exists returns everything available, once', () => {
  const candidates = [candidate('a', 0.9), candidate('b', 0.8)]
  const { selected } = selectWithMmr(candidates, 10, 0.3, () => 0.5)
  assert.equal(selected.length, 2)
  assert.equal(new Set(selected.map((s) => s.id)).size, 2)
})

test('degenerate inputs return an empty selection rather than throwing', () => {
  assert.equal(selectWithMmr([], 5, 0.2, () => 0).selected.length, 0)
  assert.equal(selectWithMmr([candidate('a', 1)], 0, 0.2, () => 0).selected.length, 0)
})

test('a non-finite weight is treated as no diversity, never as an inversion', () => {
  const { candidates, similarity } = livePool(30)
  const { selected } = selectWithMmr(candidates, 5, Number.NaN, similarity)
  assert.deepEqual(
    selected.map((s) => s.id),
    candidates.slice(0, 5).map((c) => c.id)
  )
})
