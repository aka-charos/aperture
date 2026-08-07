import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGenreWeightMap, genreAffinityFromWeights } from './index.js'
import type { GenreWeight } from './types.js'

/**
 * Verbatim copy of the body of getGenreAffinity as it stood before the fetch
 * was lifted out of it, with only the `await getUserGenreWeights(userId)` line
 * replaced by the weights being passed in. Asserting the extracted pure
 * function against this is what makes the refactor provably behavior-
 * preserving rather than merely plausible -- the whole point of the change is
 * that recommendations come out identical, just without 12k redundant queries.
 */
function legacyGenreAffinity(weights: GenreWeight[], genres: string[]): number {
  if (genres.length === 0) return 0.5

  const weightMap = new Map(weights.map((w) => [w.genre.toLowerCase(), w.weight]))

  let totalWeight = 0
  let count = 0

  for (const genre of genres) {
    const weight = weightMap.get(genre.toLowerCase())
    if (weight !== undefined) {
      totalWeight += weight
      count++
    }
  }

  if (count === 0) return 0.5

  const avgWeight = totalWeight / count
  return avgWeight / 2
}

function weight(genre: string, value: number): GenreWeight {
  return {
    id: `id-${genre}`,
    userId: 'user-1',
    genre,
    weight: value,
    isUserSet: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

const newPath = (weights: GenreWeight[], genres: string[]) =>
  genreAffinityFromWeights(buildGenreWeightMap(weights), genres)

// ============================================================================
// Behavior preservation
// ============================================================================

test('extracted genre affinity matches the pre-refactor implementation', () => {
  // weight is stored clamped to 0..2 (setGenreWeight), 1 = neutral
  const weightSets: GenreWeight[][] = [
    [],
    [weight('Action', 1)],
    [weight('Action', 0), weight('Drama', 2)],
    [weight('Action', 1.5), weight('Drama', 0.5), weight('Comedy', 2)],
    [weight('SCI-FI', 1.75), weight('horror', 0.25)],
  ]

  const genreSets: string[][] = [
    [],
    ['Action'],
    ['Unknown'],
    ['Action', 'Drama'],
    ['Action', 'Unknown'],
    ['Unknown', 'Nothing'],
    ['sci-fi', 'HORROR'],
    ['Action', 'Drama', 'Comedy'],
    ['Action', 'Action'],
  ]

  for (const weights of weightSets) {
    for (const genres of genreSets) {
      assert.equal(
        newPath(weights, genres),
        legacyGenreAffinity(weights, genres),
        `mismatch for weights=${JSON.stringify(weights.map((w) => [w.genre, w.weight]))} genres=${JSON.stringify(genres)}`
      )
    }
  }
})

// ============================================================================
// The documented contract
// ============================================================================

test('no genres and no matching genres are both neutral', () => {
  const weights = [weight('Action', 2)]
  assert.equal(newPath(weights, []), 0.5)
  assert.equal(newPath(weights, ['Documentary']), 0.5)
  assert.equal(newPath([], ['Action']), 0.5)
})

test('stored weight maps onto the 0..1 affinity range', () => {
  assert.equal(newPath([weight('Action', 0)], ['Action']), 0)
  assert.equal(newPath([weight('Action', 1)], ['Action']), 0.5)
  assert.equal(newPath([weight('Action', 2)], ['Action']), 1)
})

test('matching genres average, and unweighted genres are ignored rather than counted as neutral', () => {
  const weights = [weight('Action', 2), weight('Drama', 0)]
  assert.equal(newPath(weights, ['Action', 'Drama']), 0.5)

  // 'Unknown' has no weight, so it must not drag the average toward neutral --
  // the result is Action's alone.
  assert.equal(newPath(weights, ['Action', 'Unknown']), 1)
})

test('genre matching is case-insensitive in both directions', () => {
  assert.equal(newPath([weight('Science Fiction', 2)], ['SCIENCE FICTION']), 1)
  assert.equal(newPath([weight('SCIENCE FICTION', 2)], ['science fiction']), 1)
})

test('buildGenreWeightMap lowercases keys and keeps the stored weight', () => {
  const map = buildGenreWeightMap([weight('Action', 1.5), weight('Sci-Fi', 0.5)])
  assert.equal(map.get('action'), 1.5)
  assert.equal(map.get('sci-fi'), 0.5)
  assert.equal(map.get('Action'), undefined)
})

test('one map serves every candidate, which is the point of the split', () => {
  // The pipeline builds this once per run and reuses it across ~12k
  // candidates; reuse must not mutate or exhaust it.
  const map = buildGenreWeightMap([weight('Action', 2)])
  for (let i = 0; i < 1000; i++) {
    assert.equal(genreAffinityFromWeights(map, ['Action']), 1)
  }
  assert.equal(map.size, 1)
})
