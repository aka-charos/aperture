import test from 'node:test'
import assert from 'node:assert/strict'
import {
  interestAffinityFromSimilarity,
  buildInterestMatchIndex,
  computeReservedInterestSlots,
  pickInterestSlotFillers,
  DEFAULT_INTEREST_MAX_SLOTS,
  MIN_INTEREST_SLOT_SIMILARITY,
  INTEREST_SLOT_MATCH_POOL,
  type InterestQueryResult,
} from './interestSlots.js'

// ============================================================================
// Affinity tiering
// ============================================================================

/**
 * Verbatim copy of the tiering that lived inline in getCustomInterestAffinity
 * before it was extracted. Asserting against this is what makes the refactor
 * provably behavior-preserving rather than merely plausible.
 */
function legacyAffinity(maxWeightedSimilarity: number): number {
  if (maxWeightedSimilarity >= 0.7) return 1.0
  if (maxWeightedSimilarity >= 0.5) return 0.8
  if (maxWeightedSimilarity >= 0.3) return 0.65
  return 0.5
}

test('interestAffinityFromSimilarity matches the previous inline tiering exactly', () => {
  // Sweep the whole plausible range plus the exact boundary values and a
  // hair either side of each, where an off-by-epsilon would hide.
  const probes: number[] = [
    -1, -0.001, 0, 0.2999, 0.3, 0.3001, 0.4999, 0.5, 0.5001, 0.6999, 0.7, 0.7001, 0.9, 1, 1.5,
  ]
  for (let v = -0.2; v <= 1.2; v += 0.01) probes.push(Number(v.toFixed(4)))

  for (const probe of probes) {
    assert.equal(
      interestAffinityFromSimilarity(probe),
      legacyAffinity(probe),
      `affinity diverged at ${probe}`
    )
  }
})

test('interestAffinityFromSimilarity never returns below neutral', () => {
  // Custom interests are opt-in extra signal, never an aversion list.
  for (const probe of [-5, -1, -0.0001, 0, 0.1]) {
    assert.equal(interestAffinityFromSimilarity(probe), 0.5)
  }
})

test('the slot-filling bar sits exactly on the "moderate match" tier', () => {
  // If these drift apart, a slot could be filled by something the affinity
  // tiers still consider a weak match.
  assert.equal(interestAffinityFromSimilarity(MIN_INTEREST_SLOT_SIMILARITY), 0.8)
})

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

function interestResult(
  id: string,
  text: string,
  weight: number,
  rows: Array<[string, number]>
): InterestQueryResult {
  return {
    interestId: id,
    interestText: text,
    weight,
    rows: rows.map(([candidateId, similarity]) => ({ candidateId, similarity })),
  }
}

test('buildInterestMatchIndex keeps the strongest match per candidate', () => {
  const index = buildInterestMatchIndex([
    interestResult('i1', 'time travel', 1, [
      ['a', 0.8],
      ['b', 0.4],
    ]),
    interestResult('i2', 'dark comedy', 1, [
      ['a', 0.6],
      ['b', 0.9],
    ]),
  ])

  assert.equal(index.best.get('a')?.interestId, 'i1')
  assert.equal(index.best.get('a')?.weightedSimilarity, 0.8)
  assert.equal(index.best.get('b')?.interestId, 'i2')
  assert.equal(index.best.get('b')?.weightedSimilarity, 0.9)
  assert.equal(index.best.get('missing'), undefined)
})

test('buildInterestMatchIndex applies the interest weight before tiering', () => {
  // Raw 0.8 would tier as a strong match; halved it is only moderate. This is
  // the same `similarity * interest.weight` the old affinity loop applied.
  const index = buildInterestMatchIndex([interestResult('i1', 'weighted', 0.5, [['a', 0.8]])])

  assert.equal(index.best.get('a')?.weightedSimilarity, 0.4)
  assert.equal(index.best.get('a')?.affinity, 0.65)
})

test('buildInterestMatchIndex preserves interest order and sorts matches', () => {
  const index = buildInterestMatchIndex([
    interestResult('i1', 'first', 1, [
      ['a', 0.2],
      ['b', 0.9],
      ['c', 0.5],
    ]),
    interestResult('i2', 'second', 1, [['d', 0.7]]),
  ])

  assert.deepEqual(
    index.byInterest.map((entry) => entry.interestId),
    ['i1', 'i2']
  )
  assert.deepEqual(
    index.byInterest[0].matches.map((match) => match.candidateId),
    ['b', 'c', 'a']
  )
})

test('buildInterestMatchIndex on no interests is an empty, usable index', () => {
  const index = buildInterestMatchIndex([])
  assert.equal(index.best.size, 0)
  assert.deepEqual(index.byInterest, [])
  assert.deepEqual(pickInterestSlotFillers([], [], index, 3), [])
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

test('pickInterestSlotFillers takes the highest-scoring qualifying match', () => {
  const index = buildInterestMatchIndex([
    interestResult('i1', 'time travel', 1, [
      ['weakScoreStrongMatch', 0.95],
      ['strongScore', 0.6],
    ]),
  ])
  const scored = candidates(['weakScoreStrongMatch', 0.2], ['strongScore', 0.8])

  const fillers = pickInterestSlotFillers([], scored, index, 1)

  assert.equal(fillers.length, 1)
  // Deliberately the better *recommendation*, not the closer match to the
  // interest text -- a reserved slot should be the best time travel film you
  // haven't seen, not merely the most time-travel-ish one.
  assert.equal(fillers[0].candidate.id, 'strongScore')
  assert.equal(fillers[0].match.interestText, 'time travel')
})

test('pickInterestSlotFillers only draws from the interest top matches', () => {
  // A high-scoring title that clears the similarity bar but sits outside the
  // interest's strongest matches must not take the slot: it would be a pick
  // the user cannot recognise as honouring what they asked for. This is the
  // difference between the feature working and it looking like it did nothing.
  const rows: Array<[string, number]> = []
  for (let i = 0; i < INTEREST_SLOT_MATCH_POOL; i++) {
    rows.push([`onTopic${i}`, 0.9 - i * 0.001])
  }
  rows.push(['marginal', MIN_INTEREST_SLOT_SIMILARITY + 0.01])

  const index = buildInterestMatchIndex([interestResult('i1', 'time travel', 1, rows)])
  const scored = [
    ...rows.slice(0, INTEREST_SLOT_MATCH_POOL).map(([id]) => ({ id, finalScore: 0.3 })),
    { id: 'marginal', finalScore: 0.99 },
  ]

  const fillers = pickInterestSlotFillers([], scored, index, 1)

  assert.equal(fillers.length, 1)
  assert.notEqual(fillers[0].candidate.id, 'marginal')
  assert.ok(fillers[0].candidate.id.startsWith('onTopic'))
})

test('pickInterestSlotFillers skips matches below the moderate bar', () => {
  const justUnder = MIN_INTEREST_SLOT_SIMILARITY - 0.01
  const index = buildInterestMatchIndex([
    interestResult('i1', 'obscure', 1, [
      ['a', justUnder],
      ['b', 0.2],
    ]),
  ])

  assert.deepEqual(pickInterestSlotFillers([], candidates(['a', 0.9], ['b', 0.9]), index, 2), [])
})

test('pickInterestSlotFillers never returns an already-selected candidate', () => {
  const index = buildInterestMatchIndex([
    interestResult('i1', 'time travel', 1, [
      ['already', 0.9],
      ['fresh', 0.8],
    ]),
  ])
  const scored = candidates(['already', 0.95], ['fresh', 0.5])

  const fillers = pickInterestSlotFillers([scored[0]], scored, index, 1)

  assert.equal(fillers.length, 1)
  assert.equal(fillers[0].candidate.id, 'fresh')
})

test('pickInterestSlotFillers ignores matches that never made the candidate pool', () => {
  // The ANN query can surface an item the scoring stage filtered out; it must
  // not be resurrected into the final list.
  const index = buildInterestMatchIndex([interestResult('i1', 'ghost', 1, [['notScored', 0.9]])])

  assert.deepEqual(pickInterestSlotFillers([], candidates(['other', 0.9]), index, 1), [])
})

test('pickInterestSlotFillers gives every interest one slot before doubling up', () => {
  const index = buildInterestMatchIndex([
    interestResult('i1', 'greedy', 1, [
      ['g1', 0.95],
      ['g2', 0.94],
      ['g3', 0.93],
    ]),
    interestResult('i2', 'quiet', 1, [['q1', 0.6]]),
  ])
  const scored = candidates(['g1', 0.9], ['g2', 0.89], ['g3', 0.88], ['q1', 0.1])

  const two = pickInterestSlotFillers([], scored, index, 2)
  assert.deepEqual(
    two.map((f) => f.candidate.id),
    ['g1', 'q1']
  )

  // Third slot goes back around to the interest that still has matches left.
  const three = pickInterestSlotFillers([], scored, index, 3)
  assert.deepEqual(
    three.map((f) => f.candidate.id),
    ['g1', 'q1', 'g2']
  )
})

test('pickInterestSlotFillers leaves slots unused rather than padding', () => {
  const index = buildInterestMatchIndex([
    interestResult('i1', 'one hit', 1, [['a', 0.9]]),
    interestResult('i2', 'no hits', 1, [['weak', 0.1]]),
  ])

  const fillers = pickInterestSlotFillers([], candidates(['a', 0.9], ['weak', 0.9]), index, 3)

  assert.equal(fillers.length, 1)
  assert.equal(fillers[0].candidate.id, 'a')
})

test('pickInterestSlotFillers never duplicates or exceeds its slot count', () => {
  const index = buildInterestMatchIndex([
    interestResult('i1', 'a', 1, [
      ['x', 0.9],
      ['y', 0.8],
      ['z', 0.7],
    ]),
    interestResult('i2', 'b', 1, [
      ['x', 0.85],
      ['y', 0.75],
      ['z', 0.65],
    ]),
  ])
  const scored = candidates(['x', 0.5], ['y', 0.4], ['z', 0.3])

  for (const slots of [0, 1, 2, 3, 5, 50]) {
    const fillers = pickInterestSlotFillers([], scored, index, slots)
    const ids = fillers.map((f) => f.candidate.id)

    assert.ok(fillers.length <= Math.max(0, slots), `exceeded ${slots} slots`)
    assert.ok(fillers.length <= scored.length, 'invented candidates out of nowhere')
    assert.equal(new Set(ids).size, ids.length, `duplicate filler at ${slots} slots`)
  }
})

test('pickInterestSlotFillers is deterministic, including on score ties', () => {
  const index = buildInterestMatchIndex([
    interestResult('i1', 'tied', 1, [
      ['bbb', 0.9],
      ['aaa', 0.9],
      ['ccc', 0.9],
    ]),
  ])
  // Identical scores: the tiebreak is the lower id, so ANN ordering (which is
  // not guaranteed for equal distances) can't make picks wobble between runs.
  const scored = candidates(['bbb', 0.7], ['aaa', 0.7], ['ccc', 0.7])

  const first = pickInterestSlotFillers([], scored, index, 2)
  const second = pickInterestSlotFillers([], scored, index, 2)

  assert.deepEqual(
    first.map((f) => f.candidate.id),
    ['aaa', 'bbb']
  )
  assert.deepEqual(
    first.map((f) => f.candidate.id),
    second.map((f) => f.candidate.id)
  )
})

test('pickInterestSlotFillers reports the interest that earned each slot', () => {
  const index = buildInterestMatchIndex([
    interestResult('i1', 'time travel stories', 1, [['a', 0.9]]),
    interestResult('i2', 'dark comedies', 1, [['b', 0.8]]),
  ])
  const fillers = pickInterestSlotFillers([], candidates(['a', 0.5], ['b', 0.5]), index, 2)

  // This is what gets written to score_breakdown.interestMatch, so it has to
  // name the interest whose match set supplied the pick -- not simply the
  // candidate's globally strongest interest.
  assert.deepEqual(
    fillers.map((f) => [f.candidate.id, f.match.interestId, f.match.candidateId]),
    [
      ['a', 'i1', 'a'],
      ['b', 'i2', 'b'],
    ]
  )
})

test('pickInterestSlotFillers does nothing when no slots are reserved', () => {
  const index = buildInterestMatchIndex([interestResult('i1', 'x', 1, [['a', 0.9]])])

  assert.deepEqual(pickInterestSlotFillers([], candidates(['a', 0.9]), index, 0), [])
  assert.deepEqual(pickInterestSlotFillers([], candidates(['a', 0.9]), index, -1), [])
})
