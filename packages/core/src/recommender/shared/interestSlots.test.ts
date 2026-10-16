import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInterestMatchIndex,
  computeReservedInterestSlots,
  pickInterestSlotFillers,
  DEFAULT_INTEREST_MAX_SLOTS,
} from './interestSlots.js'
import type { InterestTitleFacts } from './interestEvidence.js'

// ============================================================================
// Reserved slot count
// ============================================================================

test('the configured ceiling is what happens, not a starting point for a hidden share', () => {
  // The regression this guards: a 0.2 share used to sit under the ceiling, so
  // 3 configured against a 10-item list quietly became 2 and nothing on screen
  // explained why.
  assert.equal(computeReservedInterestSlots(10, 5, 3), 3)
  assert.equal(computeReservedInterestSlots(12, 5, DEFAULT_INTEREST_MAX_SLOTS), 3)
  assert.equal(computeReservedInterestSlots(20, 5, 4), 4)
})

test('never more slots than the user actually wrote interests', () => {
  assert.equal(computeReservedInterestSlots(20, 1, 4), 1)
  assert.equal(computeReservedInterestSlots(20, 2, 4), 2)
})

test('computeReservedInterestSlots respects every bound across a sweep', () => {
  for (let selectedCount = 0; selectedCount <= 60; selectedCount++) {
    for (let interestCount = 0; interestCount <= 6; interestCount++) {
      for (const maxSlots of [0, 1, 3, 4, 10]) {
        const slots = computeReservedInterestSlots(selectedCount, interestCount, maxSlots)
        const at = `(${selectedCount}, ${interestCount}, ${maxSlots})`

        assert.ok(Number.isInteger(slots), `non-integer slots at ${at}`)
        assert.ok(slots >= 0, `negative slots at ${at}`)
        assert.ok(slots <= maxSlots, `over the configured ceiling at ${at}`)
        assert.ok(slots <= interestCount, `more slots than interests at ${at}`)
        // Reserved picks come out of selectedCount, so this must never go negative.
        assert.ok(selectedCount - slots >= 0, `would leave a negative target at ${at}`)
      }
    }
  }
})

test('a list shorter than the ceiling is bounded by the list', () => {
  assert.equal(computeReservedInterestSlots(2, 5, 4), 2)
  assert.equal(computeReservedInterestSlots(0, 5, 4), 0)
})

test('no interests, or a ceiling of 0, reserves nothing', () => {
  for (let selectedCount = 0; selectedCount <= 60; selectedCount++) {
    // The overwhelmingly common case: no interests configured at all.
    assert.equal(computeReservedInterestSlots(selectedCount, 0, 3), 0)
    assert.equal(computeReservedInterestSlots(selectedCount, 3, 0), 0)
  }
})

test('computeReservedInterestSlots handles nonsense input without throwing', () => {
  assert.equal(computeReservedInterestSlots(NaN, 3, 3), 0)
  assert.equal(computeReservedInterestSlots(12, NaN, 3), 0)
  assert.equal(computeReservedInterestSlots(12, 3, NaN), 0)
  assert.equal(computeReservedInterestSlots(Infinity, 3, 3), 0)
  assert.equal(computeReservedInterestSlots(-12, 3, 3), 0)
  assert.equal(computeReservedInterestSlots(12, -3, 3), 0)
  assert.equal(computeReservedInterestSlots(12, 3, -3), 0)
})

// ============================================================================
// Index building
// ============================================================================

const DARK = { interestId: 'i-dark', interestText: 'dark comedy', weight: 1 }
const DYSTOPIA = { interestId: 'i-dys', interestText: 'dystopian sci-fi', weight: 1 }

function facts(entries: Record<string, InterestTitleFacts>): Map<string, InterestTitleFacts> {
  return new Map(Object.entries(entries))
}

test('only titles whose metadata says the interest are matches', () => {
  // The live nearest-by-embedding titles to "dark comedy" were mostly titles
  // sharing its words. None of them is a match without the tag.
  const index = buildInterestMatchIndex(
    [DARK],
    facts({
      drama: { genres: ['Romance', 'Comedy', 'Drama'], keywords: ['dark comedy'] },
      darkHorse: { genres: ['Drama'], keywords: [] },
      kingOfComedy: { genres: ['Comedy', 'Crime'], keywords: ['stand-up comedy'] },
    })
  )
  assert.deepEqual(
    index.byInterest[0].matches.map((m) => m.candidateId),
    ['drama']
  )
  assert.equal(index.best.get('drama')?.affinity, 1.0)
  assert.equal(index.best.has('darkHorse'), false)
})

test('phrase evidence sorts before parts and wins the best map', () => {
  const index = buildInterestMatchIndex(
    [DYSTOPIA, { interestId: 'i-dys2', interestText: 'dystopia', weight: 1 }],
    facts({
      a: { genres: ['Science Fiction'], keywords: ['dystopia'] },
    })
  )
  // "dystopian sci-fi" is assembled from parts (0.8); "dystopia" is one keyword (1.0).
  assert.equal(index.byInterest[0].matches[0].evidence.strength, 'parts')
  assert.equal(index.byInterest[0].matches[0].affinity, 0.8)
  assert.equal(index.best.get('a')?.interestId, 'i-dys2')
  assert.equal(index.best.get('a')?.affinity, 1.0)
})

test('the interest weight scales the affinity toward neutral', () => {
  const index = buildInterestMatchIndex(
    [{ ...DARK, weight: '0.5' }],
    facts({ a: { keywords: ['dark comedy'] } })
  )
  assert.equal(index.best.get('a')?.affinity, 0.75)
})

test('interest order is preserved; no interests is an empty, usable index', () => {
  const index = buildInterestMatchIndex([DYSTOPIA, DARK], facts({}))
  assert.deepEqual(index.byInterest.map((i) => i.interestId), ['i-dys', 'i-dark'])
  const empty = buildInterestMatchIndex([], new Map())
  assert.equal(empty.best.size, 0)
  assert.deepEqual(pickInterestSlotFillers([], [], empty, 3), [])
})

// ============================================================================
// Slot filling
// ============================================================================

interface TestCandidate {
  id: string
  finalScore: number
}

function candidates(...entries: Array<[string, number]>): TestCandidate[] {
  return entries.map(([id, finalScore]) => ({ id, finalScore }))
}

const TAGGED = { keywords: ['dark comedy'] }

test('the slot goes to the best-scoring title among the verified matches', () => {
  const index = buildInterestMatchIndex([DARK], facts({ low: TAGGED, high: TAGGED, untagged: {} }))
  const fillers = pickInterestSlotFillers(
    [],
    candidates(['low', 0.4], ['high', 0.7], ['untagged', 0.99]),
    index,
    1
  )
  assert.deepEqual(fillers.map((f) => f.candidate.id), ['high'])
  assert.deepEqual(fillers[0].match.evidence, { strength: 'phrase', matched: ['dark comedy'] })
})

test('a whole-phrase tag beats a higher-scoring title matched from parts', () => {
  const index = buildInterestMatchIndex(
    [DYSTOPIA],
    facts({
      parts: { genres: ['Science Fiction'], keywords: ['dystopia'] },
      phrase: { keywords: ['dystopian science fiction'] },
    })
  )
  const fillers = pickInterestSlotFillers([], candidates(['parts', 0.9], ['phrase', 0.5]), index, 1)
  assert.deepEqual(fillers.map((f) => f.candidate.id), ['phrase'])
})

test('parts evidence fills the slot when no whole-phrase tag is free', () => {
  const index = buildInterestMatchIndex(
    [DYSTOPIA],
    facts({
      parts: { genres: ['Science Fiction'], keywords: ['dystopia'] },
      phrase: { keywords: ['dystopian science fiction'] },
    })
  )
  const fillers = pickInterestSlotFillers(
    candidates(['phrase', 0.5]),
    candidates(['parts', 0.9], ['phrase', 0.5]),
    index,
    1
  )
  assert.deepEqual(fillers.map((f) => f.candidate.id), ['parts'])
})

test('an interest nothing is tagged with leaves its slot unused', () => {
  const index = buildInterestMatchIndex([DARK], facts({ a: { genres: ['Drama'] } }))
  assert.deepEqual(pickInterestSlotFillers([], candidates(['a', 0.9]), index, 2), [])
})

test('never an already-selected candidate, never one outside the scored pool', () => {
  const index = buildInterestMatchIndex([DARK], facts({ taken: TAGGED, gone: TAGGED, free: TAGGED }))
  const fillers = pickInterestSlotFillers(
    candidates(['taken', 0.9]),
    candidates(['taken', 0.9], ['free', 0.3]),
    index,
    3
  )
  assert.deepEqual(fillers.map((f) => f.candidate.id), ['free'])
})

test('every interest gets one slot before any gets a second', () => {
  const index = buildInterestMatchIndex(
    [DARK, DYSTOPIA],
    facts({
      d1: TAGGED,
      d2: TAGGED,
      s1: { keywords: ['dystopian science fiction'] },
    })
  )
  const fillers = pickInterestSlotFillers(
    [],
    candidates(['d1', 0.9], ['d2', 0.8], ['s1', 0.1]),
    index,
    3
  )
  assert.deepEqual(fillers.map((f) => f.candidate.id), ['d1', 's1', 'd2'])
  assert.deepEqual(fillers.map((f) => f.match.interestText), ['dark comedy', 'dystopian sci-fi', 'dark comedy'])
})

test('deterministic on score ties, and nothing when no slots are reserved', () => {
  const index = buildInterestMatchIndex([DARK], facts({ b: TAGGED, a: TAGGED }))
  const fillers = pickInterestSlotFillers([], candidates(['b', 0.5], ['a', 0.5]), index, 1)
  assert.deepEqual(fillers.map((f) => f.candidate.id), ['a'])
  assert.deepEqual(pickInterestSlotFillers([], candidates(['a', 0.5]), index, 0), [])
})
