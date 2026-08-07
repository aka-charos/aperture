import test from 'node:test'
import assert from 'node:assert/strict'
import { maxTasteSimilarity } from './scorer.js'

/** Plain cosine, normalized to [0,1] the way the scorer reports similarity. */
function normalizedCosine(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return ((magnitude === 0 ? 0 : dot / magnitude) + 1) / 2
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-12

test('a single taste vector reproduces the old single-centroid result', () => {
  const taste = [0.4, 0.7, 0.2]
  const candidate = [0.5, 0.6, 0.1]

  assert.ok(
    close(maxTasteSimilarity([taste], candidate)!, normalizedCosine(taste, candidate)),
    'one cluster must score exactly as the pre-cluster code did'
  )
})

test('a candidate matching one facet strongly scores as a strong match, not an average', () => {
  const clusters = [
    [1, 0, 0], // gritty crime, say
    [0, 1, 0], // whimsical animation
  ]
  const candidate = [0.9, 0.1, 0] // squarely in the first facet

  const result = maxTasteSimilarity(clusters, candidate)!
  const best = normalizedCosine(clusters[0], candidate)
  const averaged = (normalizedCosine(clusters[0], candidate) + normalizedCosine(clusters[1], candidate)) / 2

  assert.ok(close(result, best), `expected the best facet (${best}), got ${result}`)
  assert.ok(
    result > averaged + 0.1,
    'averaging the facets would recreate the dilution clusters exist to avoid'
  )
})

test('order of the clusters does not matter', () => {
  const a = [1, 0, 0]
  const b = [0, 1, 0]
  const candidate = [0.2, 0.9, 0.1]

  assert.equal(maxTasteSimilarity([a, b], candidate), maxTasteSimilarity([b, a], candidate))
})

test('a mismatched dimension is skipped, not scored as zero', () => {
  const usable = [1, 0, 0]
  const stale = [1, 0] // e.g. left over from a different embedding model
  const candidate = [-1, 0, 0] // genuinely opposed to the usable vector

  const result = maxTasteSimilarity([stale, usable], candidate)!

  // cosineSimilarity returns 0 for a length mismatch, which normalizes to 0.5.
  // If the stale vector were scored rather than skipped it would win here and
  // report a neutral match for a candidate that is the opposite of the taste.
  assert.ok(close(result, normalizedCosine(usable, candidate)), `got ${result}`)
  assert.ok(result < 0.01, 'an opposed candidate must not read as neutral')
})

test('null when there is nothing comparable to score against', () => {
  assert.equal(maxTasteSimilarity([], [0.1, 0.2]), null)
  assert.equal(maxTasteSimilarity([[0.1, 0.2]], []), null)
  // Every vector the wrong width -> nothing usable, so the caller falls back
  // to its neutral default rather than inventing a score.
  assert.equal(maxTasteSimilarity([[0.1, 0.2]], [0.1, 0.2, 0.3]), null)
})

test('result always lands inside [0,1]', () => {
  const clusters = [
    [1, 0],
    [-1, 0],
    [0.3, -0.9],
  ]
  for (const candidate of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0.5, 0.5],
  ]) {
    const result = maxTasteSimilarity(clusters, candidate)!
    assert.ok(result >= 0 && result <= 1, `${result} out of range for ${candidate}`)
  }
})
