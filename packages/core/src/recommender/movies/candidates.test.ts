import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeClusterCandidatesByMaxSimilarity } from './candidates.js'
import type { Candidate } from '../types.js'

function candidate(id: string, similarity: number): Candidate {
  return {
    movieId: id,
    id,
    title: `Movie ${id}`,
    year: 2020,
    genres: [],
    communityRating: null,
    similarity,
    normalizedSimilarity: 0,
    novelty: 0,
    ratingScore: 0,
    diversityScore: 0,
    diversityBoost: 0,
    finalScore: 0,
  }
}

test('merging a single cluster result set returns it sorted by similarity', () => {
  const merged = mergeClusterCandidatesByMaxSimilarity([
    [candidate('a', 0.3), candidate('b', 0.9), candidate('c', 0.6)],
  ])
  assert.deepEqual(
    merged.map((c) => c.id),
    ['b', 'c', 'a']
  )
})

test('a candidate in two clusters keeps its highest similarity, not an average', () => {
  const merged = mergeClusterCandidatesByMaxSimilarity([
    [candidate('shared', 0.9), candidate('onlyA', 0.4)],
    [candidate('shared', 0.1), candidate('onlyB', 0.5)],
  ])

  const shared = merged.find((c) => c.id === 'shared')
  assert.ok(shared)
  // An average would give 0.5 -- worse than the 0.9 the strong facet match
  // deserves, and exactly the dilution multi-centroid retrieval exists to fix.
  assert.equal(shared.similarity, 0.9)
})

test('max is taken regardless of which cluster listed the candidate first', () => {
  const lowFirst = mergeClusterCandidatesByMaxSimilarity([
    [candidate('x', 0.2)],
    [candidate('x', 0.8)],
  ])
  const highFirst = mergeClusterCandidatesByMaxSimilarity([
    [candidate('x', 0.8)],
    [candidate('x', 0.2)],
  ])
  assert.equal(lowFirst[0].similarity, 0.8)
  assert.equal(highFirst[0].similarity, 0.8)
})

test('output size equals the union of candidate ids', () => {
  const merged = mergeClusterCandidatesByMaxSimilarity([
    [candidate('a', 0.5), candidate('b', 0.4)],
    [candidate('b', 0.6), candidate('c', 0.3)],
    [candidate('c', 0.7), candidate('d', 0.2)],
  ])
  assert.equal(merged.length, 4)
  assert.deepEqual(
    merged.map((c) => c.id).sort(),
    ['a', 'b', 'c', 'd']
  )
})

test('merged output is sorted by descending similarity', () => {
  const merged = mergeClusterCandidatesByMaxSimilarity([
    [candidate('a', 0.1), candidate('b', 0.95)],
    [candidate('c', 0.55), candidate('a', 0.7)],
  ])
  for (let i = 1; i < merged.length; i++) {
    assert.ok(
      merged[i - 1].similarity >= merged[i].similarity,
      `not sorted at index ${i}: ${merged[i - 1].similarity} < ${merged[i].similarity}`
    )
  }
  assert.equal(merged[0].id, 'b')
})

test('empty inputs merge to an empty list', () => {
  assert.deepEqual(mergeClusterCandidatesByMaxSimilarity([]), [])
  assert.deepEqual(mergeClusterCandidatesByMaxSimilarity([[], []]), [])
})

test('merging preserves the full candidate record, not just id and similarity', () => {
  const merged = mergeClusterCandidatesByMaxSimilarity([[candidate('a', 0.5)]])
  assert.equal(merged[0].movieId, 'a')
  assert.equal(merged[0].title, 'Movie a')
  assert.equal(merged[0].year, 2020)
})
