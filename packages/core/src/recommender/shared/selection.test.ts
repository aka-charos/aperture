import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDiversitySelection,
  applySimpleSelection,
  calculateDiversityBoost,
  type SelectableCandidate,
} from './selection.js'

function candidate(
  id: string,
  finalScore: number,
  genres: string[],
  extra: Partial<SelectableCandidate> = {}
): SelectableCandidate {
  return {
    id,
    title: `Title ${id}`,
    year: 2020,
    genres,
    similarity: finalScore,
    novelty: 0.5,
    ratingScore: 0.5,
    diversityBoost: 0,
    finalScore,
    ...extra,
  }
}

/** A fresh fixture every time -- both selectors mutate what they're handed. */
function fixture(): SelectableCandidate[] {
  return [
    candidate('a', 0.9, ['Action']),
    candidate('b', 0.88, ['Action', 'Thriller']),
    candidate('c', 0.85, ['Comedy']),
    candidate('d', 0.8, ['Action']),
    candidate('e', 0.75, ['Drama', 'Romance']),
    candidate('f', 0.7, ['Documentary']),
    candidate('g', 0.65, ['Action', 'Thriller']),
    candidate('h', 0.6, ['Horror']),
  ]
}

/**
 * Verbatim copy of the selection loop as it stood when it wrote the blended
 * score back over finalScore, reduced to just the ordering decision. Asserting
 * the new implementation picks the same ids in the same order against this is
 * what makes the split provably display-only: the blend was already computed
 * from a `baseScores` snapshot taken before any mutation, so overwriting
 * finalScore never fed back into selection -- but that's an argument, and this
 * is a check.
 */
function legacySelectionOrder(
  candidates: SelectableCandidate[],
  targetCount: number,
  diversityWeight: number
): string[] {
  const selected: string[] = []
  const selectedGenres = new Map<string, number>()
  const selectedTitles = new Set<string>()
  const baseScores = new Map(candidates.map((c) => [c.id, c.finalScore]))
  const remaining = new Set(candidates.map((c) => c.id))
  const byId = new Map(candidates.map((c) => [c.id, c]))

  while (selected.length < targetCount && remaining.size > 0) {
    let bestId: string | null = null
    let bestScore = -Infinity

    for (const id of remaining) {
      const c = byId.get(id)!
      const titleKey = `${c.title.toLowerCase()}|${c.year || 'unknown'}`
      if (selectedTitles.has(titleKey)) continue

      const boost = calculateDiversityBoost(c, selectedGenres, null, selected.length)
      const selectionScore = baseScores.get(id)! * (1 - diversityWeight) + boost * diversityWeight

      if (selectionScore > bestScore) {
        bestScore = selectionScore
        bestId = id
      }
    }

    if (bestId === null) break

    const best = byId.get(bestId)!
    remaining.delete(bestId)
    // The mutation this change removes. Kept here so the replica is faithful.
    best.finalScore = bestScore
    selectedTitles.add(`${best.title.toLowerCase()}|${best.year || 'unknown'}`)
    for (const genre of best.genres) {
      selectedGenres.set(genre, (selectedGenres.get(genre) || 0) + 1)
    }
    selected.push(bestId)
  }

  return selected
}

// ============================================================================
// The split itself
// ============================================================================

test('applyDiversitySelection leaves every finalScore untouched', () => {
  const candidates = fixture()
  const before = new Map(candidates.map((c) => [c.id, c.finalScore]))

  applyDiversitySelection(candidates, 5, 0.3, false)

  for (const c of candidates) {
    assert.equal(c.finalScore, before.get(c.id), `finalScore moved for ${c.id}`)
  }
})

test('applyDiversitySelection records the blend on selectionScore', () => {
  const candidates = fixture()
  const diversityWeight = 0.3

  const { selected } = applyDiversitySelection(candidates, 5, diversityWeight, false)

  for (const c of selected) {
    assert.notEqual(c.selectionScore, undefined, `no selectionScore on ${c.id}`)
    const expected = c.finalScore * (1 - diversityWeight) + c.diversityBoost * diversityWeight
    assert.ok(
      Math.abs(c.selectionScore! - expected) < 1e-12,
      `${c.id}: selectionScore ${c.selectionScore} != base*(1-w) + boost*w = ${expected}`
    )
  }
})

test('unselected candidates get no selectionScore at all', () => {
  const candidates = fixture()
  const { selected } = applyDiversitySelection(candidates, 3, 0.3, false)
  const selectedIds = new Set(selected.map((c) => c.id))

  for (const c of candidates) {
    if (selectedIds.has(c.id)) continue
    assert.equal(c.selectionScore, undefined, `${c.id} was never selected but carries a blend`)
  }
})

test('the two scores coincide when diversity is switched off', () => {
  const candidates = fixture()
  const { selected } = applyDiversitySelection(candidates, 5, 0, false)

  for (const c of selected) {
    assert.equal(c.selectionScore, c.finalScore)
  }
})

// ============================================================================
// Behavior preservation -- ordering must not have changed
// ============================================================================

test('selection order is identical to the pre-split implementation', () => {
  for (const diversityWeight of [0, 0.15, 0.3, 0.5, 0.8, 1]) {
    const expected = legacySelectionOrder(fixture(), 5, diversityWeight)
    const { selected } = applyDiversitySelection(fixture(), 5, diversityWeight, false)

    assert.deepEqual(
      selected.map((c) => c.id),
      expected,
      `order diverged at diversityWeight=${diversityWeight}`
    )
  }
})

test('selectedRanks still follow selection order', () => {
  const candidates = fixture()
  const { selected, selectedRanks } = applyDiversitySelection(candidates, 4, 0.3, false)

  selected.forEach((c, i) => {
    assert.equal(selectedRanks.get(c.id), i + 1)
  })
})

test('duplicate titles are still skipped', () => {
  const candidates = [
    candidate('a', 0.9, ['Action']),
    candidate('a-copy', 0.89, ['Action']),
    candidate('b', 0.5, ['Comedy']),
  ]
  // Same title+year as 'a', which is how a second library copy shows up.
  candidates[1].title = candidates[0].title

  const { selected } = applyDiversitySelection(candidates, 3, 0.3, false)
  assert.deepEqual(selected.map((c) => c.id), ['a', 'b'])
})

// ============================================================================
// The unused sibling, kept consistent so it isn't a trap later
// ============================================================================

test('applySimpleSelection splits the scores the same way', () => {
  const candidates = fixture()
  const before = new Map(candidates.map((c) => [c.id, c.finalScore]))
  const diversityWeight = 0.3

  const { selected } = applySimpleSelection(candidates, 4, diversityWeight)

  for (const c of candidates) {
    assert.equal(c.finalScore, before.get(c.id), `finalScore moved for ${c.id}`)
  }
  for (const c of selected) {
    const expected = c.finalScore + c.diversityBoost * diversityWeight
    assert.ok(
      Math.abs(c.selectionScore! - expected) < 1e-12,
      `${c.id}: selectionScore ${c.selectionScore} != finalScore + boost*w = ${expected}`
    )
  }
})
