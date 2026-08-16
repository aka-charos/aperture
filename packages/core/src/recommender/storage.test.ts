/**
 * Pins how scored candidates become stored rows.
 *
 * This is the layer where a regression is silent. Dropping rows, renumbering
 * ranks or losing a pick all produce a run that looks completely healthy in the
 * logs — the damage only shows up as a blank insights panel, or as a
 * recommendation card that vanished because /api/recommendations reads the
 * picks back out of this table.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildCandidateRows, type StoredInterestPick, type StoredTwinPick } from './storage.js'
import type { Candidate } from './types.js'

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    movieId: id,
    id,
    title: `Movie ${id}`,
    year: 2020,
    genres: ['Drama'],
    communityRating: 7,
    similarity: 0.5,
    normalizedSimilarity: 0.5,
    novelty: 0.6,
    ratingScore: 0.7,
    diversityScore: 0,
    diversityBoost: 0,
    finalScore: 0.8,
    ...overrides,
  }
}

/** A scored pool of `n` candidates, already ranked the way the pipeline hands them over. */
function pool(n: number): Candidate[] {
  return Array.from({ length: n }, (_, i) => candidate(`m${i + 1}`, { finalScore: 1 - i / n }))
}

describe('buildCandidateRows', () => {
  test('keeps every scored candidate, not the first hundred', () => {
    // The whole point of the change: movies used to slice(0, 100) here, so a
    // library of thousands produced a hundred explainable titles per user.
    const rows = buildCandidateRows(pool(2500), [])

    assert.equal(rows.length, 2500)
    assert.equal(rows[2499]!.movieId, 'm2500')
  })

  test('ranks are dense, 1-based and follow the scored order', () => {
    const rows = buildCandidateRows(pool(150), [])

    assert.equal(rows[0]!.rank, 1)
    assert.equal(rows[99]!.rank, 100)
    // The old code switched to an O(n) findIndex past position 100. Anything
    // that reintroduces a second rank path shows up right here.
    assert.equal(rows[100]!.rank, 101)
    assert.equal(rows[149]!.rank, 150)
    assert.deepEqual(
      rows.map((r) => r.rank),
      rows.map((_, i) => i + 1)
    )
  })

  test('a pick chosen from deep in the pool keeps its overall rank', () => {
    // Diversity selection reaches past the head of the list, and `rank` has to
    // stay the position among everything considered — that is what makes
    // "#340 of 12,000" true.
    const candidates = pool(500)
    const deep = candidates[339]!
    const rows = buildCandidateRows(candidates, [deep], new Map([[deep.movieId, 4]]))

    const stored = rows.find((r) => r.movieId === deep.movieId)!
    assert.equal(stored.rank, 340)
    assert.equal(stored.isSelected, true)
    assert.equal(stored.selectedRank, 4)
  })

  test('non-selected rows carry no selected rank', () => {
    const candidates = pool(10)
    const rows = buildCandidateRows(candidates, [candidates[0]!], new Map([['m1', 1]]))

    assert.equal(rows[0]!.selectedRank, 1)
    for (const row of rows.slice(1)) {
      assert.equal(row.isSelected, false)
      assert.equal(row.selectedRank, null)
    }
  })

  test('an ordinary candidate stores no breakdown at all', () => {
    // Every score on an ordinary row already has its own column. Copying them
    // into JSONB as well was free on a hundred rows and is not on twelve
    // thousand, so null here is load-bearing rather than tidiness.
    const rows = buildCandidateRows(pool(3), [])

    for (const row of rows) {
      assert.equal(row.scoreBreakdown, null)
    }
  })

  test('the breakdown appears only for what no column holds', () => {
    const picked = candidate('m1', { selectionScore: 0.91 })
    const rows = buildCandidateRows([picked, candidate('m2')], [picked])

    const parsed = JSON.parse(rows[0]!.scoreBreakdown!)
    assert.deepEqual(parsed, { selectionScore: 0.91 })
    // Not duplicated out of their columns.
    assert.equal('similarity' in parsed, false)
    assert.equal('novelty' in parsed, false)
    assert.equal(rows[1]!.scoreBreakdown, null)
  })

  test('an interest pick records which interest reserved the slot', () => {
    const pick: StoredInterestPick = {
      interestId: 'int-1',
      interestText: 'slow-burn folk horror',
      weightedSimilarity: 0.73,
    }
    const rows = buildCandidateRows(
      pool(2),
      [],
      undefined,
      new Map([['m2', pick]])
    )

    assert.equal(rows[0]!.scoreBreakdown, null)
    assert.deepEqual(JSON.parse(rows[1]!.scoreBreakdown!), { interestMatch: pick })
  })

  test('a twin pick records the overlap that earned it the slot', () => {
    // The ids are what the insights panel resolves into "you both watched
    // these". Without them the panel falls back to the content-similarity
    // carousel, which is computed after selection and explains nothing about a
    // borrowed pick.
    const pick: StoredTwinPick = {
      donorId: 'donor-1',
      affinity: 0.19,
      sharedCount: 42,
      sharedIds: ['shared-a', 'shared-b'],
    }
    const rows = buildCandidateRows(pool(2), [], undefined, undefined, new Map([['m2', pick]]))

    assert.deepEqual(JSON.parse(rows[1]!.scoreBreakdown!), { twinMatch: pick })
  })

  test('a twin pick from a run with no recorded overlap omits the key entirely', () => {
    // Runs generated before sharedIds existed, and any pair whose ids failed to
    // come back. Writing `sharedIds: []` would make the read path distinguish
    // empty from absent for no gain.
    const rows = buildCandidateRows(
      pool(1),
      [],
      undefined,
      undefined,
      new Map([['m1', { donorId: 'd', affinity: 0.1, sharedCount: 11 }]])
    )

    const parsed = JSON.parse(rows[0]!.scoreBreakdown!)
    assert.equal('sharedIds' in parsed.twinMatch, false)
  })

  test('diversity is null for anything the selector never ranked', () => {
    // diversityScore is initialised to 0 and only written for candidates that
    // pass through applyDiversityAndSelect. Storing that 0 made the insights
    // panel report a confident "Variety 0%" for every scored-but-unpicked title
    // and for every reserved-slot filler — a measurement for something never
    // measured. selectionScore is the mark the selector leaves behind.
    const ranked = candidate('m1', { selectionScore: 0.91, diversityScore: 0.4 })
    const filler = candidate('m2')
    const rows = buildCandidateRows([ranked, filler], [ranked, filler])

    assert.equal(rows[0]!.diversityScore, 0.4)
    assert.equal(rows[1]!.diversityScore, null)
  })

  test('a genuine zero diversity is kept, not turned into null', () => {
    // A candidate whose genres fully overlap what is already selected really
    // does score 0 here, and that is a measurement worth showing.
    const ranked = candidate('m1', { selectionScore: 0.5, diversityScore: 0 })
    const rows = buildCandidateRows([ranked], [ranked])

    assert.equal(rows[0]!.diversityScore, 0)
  })

  test('both similarity scales are stored, not just the raw cosine', () => {
    // The insights panel blends normalizedSimilarity, novelty and rating; it
    // used to render the *raw* cosine under "Taste Match" because that was the
    // only one persisted, so the three bars could not produce the match above
    // them. Live: 78 / 72 / 85 under a headline of 90.
    const c = candidate('m1', { similarity: 0.61, normalizedSimilarity: 0.94 })
    const rows = buildCandidateRows([c], [c])

    assert.equal(rows[0]!.similarity, 0.61)
    assert.equal(rows[0]!.normalizedSimilarity, 0.94)
  })

  test('the pre-preference blend is stored so the components can account for the match', () => {
    // applyPreferenceAdjustment moves finalScore by up to half the remaining
    // headroom, so without baseScore the gap between the three components and
    // the match has no visible cause.
    const c = candidate('m1', { baseScore: 0.82, finalScore: 0.9 })
    const rows = buildCandidateRows([c], [c])

    assert.equal(rows[0]!.baseScore, 0.82)
    assert.equal(rows[0]!.finalScore, 0.9)
  })

  test('an absent base score is null rather than zero', () => {
    // Same trap as diversity: a stored 0 renders as a measured "no preference
    // effect", which is a different claim from "never recorded".
    const rows = buildCandidateRows([candidate('m1')], [])

    assert.equal(rows[0]!.baseScore, null)
  })

  test('a pick missing from the scored pool is stored anyway', () => {
    // Should not happen — selection draws from the scored list. But a pick that
    // never reaches this table disappears from the recommendations page, so the
    // guard is worth more than the Set it costs.
    const orphan = candidate('ghost')
    const rows = buildCandidateRows(pool(5), [orphan])

    assert.equal(rows.length, 6)
    const stored = rows.find((r) => r.movieId === 'ghost')!
    assert.equal(stored.isSelected, true)
    assert.equal(stored.rank, 6)
  })

  test('an empty pool produces no rows', () => {
    assert.deepEqual(buildCandidateRows([], []), [])
  })
})
