import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allocateClusterCandidateLimits, MIN_CANDIDATES_PER_CLUSTER } from './clusterAllocation.js'

test('k=1 passes the whole budget through unchanged', () => {
  assert.deepEqual(allocateClusterCandidateLimits([1], 50000), [50000])
  assert.deepEqual(allocateClusterCandidateLimits([0.42], 12), [12])
})

test('empty cluster list allocates nothing', () => {
  assert.deepEqual(allocateClusterCandidateLimits([], 50000), [])
})

test('allocations sum to the total budget (within rounding) and respect the floor', () => {
  const cases: Array<{ weights: number[]; total: number }> = [
    { weights: [0.5, 0.5], total: 50000 },
    { weights: [0.7, 0.3], total: 50000 },
    { weights: [0.6, 0.25, 0.15], total: 50000 },
    { weights: [0.34, 0.33, 0.33], total: 10000 },
  ]

  for (const { weights, total } of cases) {
    const limits = allocateClusterCandidateLimits(weights, total)
    assert.equal(limits.length, weights.length)

    const sum = limits.reduce((s, n) => s + n, 0)
    // Only Math.round error, at most 1 per cluster.
    assert.ok(Math.abs(sum - total) <= weights.length, `sum ${sum} vs total ${total}`)

    for (const limit of limits) {
      assert.ok(
        limit >= MIN_CANDIDATES_PER_CLUSTER,
        `allocation ${limit} fell below the ${MIN_CANDIDATES_PER_CLUSTER} floor`
      )
    }
  }
})

test('an extremely lopsided split still gives the minority clusters the floor', () => {
  const limits = allocateClusterCandidateLimits([0.98, 0.01, 0.01], 50000)
  assert.equal(limits.length, 3)
  assert.ok(limits[0] > limits[1], 'dominant cluster should still get the largest share')
  assert.equal(limits[1], limits[2])
  for (const limit of limits) {
    assert.ok(limit >= MIN_CANDIDATES_PER_CLUSTER, `minority cluster starved to ${limit}`)
  }
})

test('larger weight always earns a larger-or-equal allocation', () => {
  const weights = [0.5, 0.3, 0.2]
  const limits = allocateClusterCandidateLimits(weights, 50000)
  assert.ok(limits[0] >= limits[1])
  assert.ok(limits[1] >= limits[2])
})

test('degrades to an even split when the budget cannot floor every cluster', () => {
  const total = MIN_CANDIDATES_PER_CLUSTER * 2 - 10
  const limits = allocateClusterCandidateLimits([0.9, 0.1], total)
  assert.equal(limits.length, 2)
  assert.equal(limits[0], limits[1])
  assert.equal(limits[0], Math.floor(total / 2))
  assert.ok(limits[0] + limits[1] <= total, 'even split must not exceed the budget')
})

test('zero-sum weights fall back to an even share of the remainder rather than dividing by zero', () => {
  const limits = allocateClusterCandidateLimits([0, 0], 50000)
  assert.equal(limits.length, 2)
  for (const limit of limits) {
    assert.ok(Number.isFinite(limit), 'allocation must be finite')
    assert.ok(limit >= MIN_CANDIDATES_PER_CLUSTER)
  }
})
