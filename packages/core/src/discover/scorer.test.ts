import test from 'node:test'
import assert from 'node:assert/strict'
import { maxTasteSimilarity, franchiseKeys, tasteSimilarityRanks } from './scorer.js'

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

// ---------------------------------------------------------------------------
// franchiseKeys
// ---------------------------------------------------------------------------

test('a TMDb collection name and the canonical name resolve to a common key', () => {
  // The defect this exists to prevent: stored movie preferences are keyed on
  // `movies.collection_name` ("The Avengers Collection") while the scorer
  // identifies a candidate with detectFranchiseFromTitle ("Marvel Cinematic
  // Universe"), so the lookup missed on every enriched library and the
  // franchise nudge silently never fired for movies.
  const stored = franchiseKeys('The Avengers Collection')
  const candidate = franchiseKeys('Avengers: Endgame')

  const shared = stored.filter((k) => candidate.includes(k))
  assert.ok(
    shared.length > 0,
    `no shared key between ${JSON.stringify(stored)} and ${JSON.stringify(candidate)}`
  )
  assert.ok(stored.includes('marvel cinematic universe'))
})

test('the trailing "Collection" is stripped, covering franchises with no regex pattern', () => {
  // "Alien Collection" has a pattern, but the stripped form is what carries
  // collections the table has never heard of.
  const stored = franchiseKeys('Some Indie Trilogy Collection')
  assert.ok(stored.includes('some indie trilogy'))
  assert.ok(stored.includes('some indie trilogy collection'))
})

test('keys are lowercased and the original name is always present', () => {
  const keys = franchiseKeys('Star Wars')
  assert.ok(keys.includes('star wars'))
  for (const key of keys) {
    assert.equal(key, key.toLowerCase(), `${key} is not lowercased`)
  }
})

test('an unrecognised name still yields its own key rather than nothing', () => {
  assert.deepEqual(franchiseKeys('Some Unknown Thing'), ['some unknown thing'])
})

test('an empty or whitespace name yields no keys', () => {
  // Guards the lookup map against a blank key that would match a blank title.
  assert.deepEqual(franchiseKeys(''), [])
  assert.deepEqual(franchiseKeys('   '), [])
})

// ---------------------------------------------------------------------------
// tasteSimilarityRanks
// ---------------------------------------------------------------------------

test('the strongest taste match ranks first, not last', () => {
  // The failure this guards is silent and user-facing: a sort in the wrong
  // direction presents the WEAKEST match as #1 on the detail card, and nothing
  // in a type or a log would say so.
  const ranks = tasteSimilarityRanks(
    new Map([
      [10, 0.43],
      [20, 0.66],
      [30, 0.55],
    ])
  )

  assert.equal(ranks.get(20), 1)
  assert.equal(ranks.get(30), 2)
  assert.equal(ranks.get(10), 3)
})

test('ranks are 1-based, so nothing renders as "#0 of n"', () => {
  const ranks = tasteSimilarityRanks(new Map([[1, 0.5]]))
  assert.equal(ranks.get(1), 1)
})

test('every candidate given a similarity gets a rank, and none is skipped', () => {
  const input = new Map([
    [1, 0.51],
    [2, 0.49],
    [3, 0.60],
    [4, 0.44],
  ])
  const ranks = tasteSimilarityRanks(input)

  assert.equal(ranks.size, input.size)
  assert.deepEqual([...ranks.values()].sort((a, b) => a - b), [1, 2, 3, 4])
})

test('ties keep input order, so the ranking is stable between runs', () => {
  const ranks = tasteSimilarityRanks(
    new Map([
      [7, 0.5],
      [8, 0.5],
      [9, 0.5],
    ])
  )

  assert.equal(ranks.get(7), 1)
  assert.equal(ranks.get(8), 2)
  assert.equal(ranks.get(9), 3)
})

test('no similarities means no ranks rather than a phantom first place', () => {
  assert.equal(tasteSimilarityRanks(new Map()).size, 0)
})
