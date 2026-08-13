import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTwinIndex,
  computeReservedTwinSlots,
  deriveTwinThreshold,
  pickTwinSlotFillers,
  type TwinDonor,
  type TwinPair,
} from './twinSlots.js'
import { computeReservedInterestSlots } from './interestSlots.js'

const pair = (recipientId: string, donorId: string, affinity: number): TwinPair => ({
  recipientId,
  donorId,
  affinity,
  sharedCount: 42,
})

const donor = (donorId: string, affinity: number): TwinDonor => ({
  donorId,
  affinity,
  sharedCount: 42,
})

const candidate = (id: string, finalScore: number) => ({ id, finalScore })

describe('deriveTwinThreshold', () => {
  test('is median + k x MAD, not mean + k x standard deviation', () => {
    // median 3; deviations 2,1,0,1,97 -> median deviation 1. A mean/SD test
    // would be dragged upward by the 100 and let it through, which is the exact
    // failure mode this function exists to avoid.
    const values = [1, 2, 3, 4, 100]
    assert.equal(deriveTwinThreshold(values, 2), 5)
    assert.equal(deriveTwinThreshold(values, 1), 4)
  })

  test('an even-length sample averages the middle two', () => {
    // median of [10,20,30,40] is 25; deviations 15,5,5,15 -> 10.
    assert.equal(deriveTwinThreshold([10, 20, 30, 40], 1), 35)
  })

  test('no spread means no outlier, so no threshold', () => {
    // Returning the median here would admit every pair at or above the middle.
    assert.equal(deriveTwinThreshold([0.2, 0.2, 0.2, 0.2], 2), null)
  })

  test('empty input and a non-positive k yield null', () => {
    assert.equal(deriveTwinThreshold([], 2), null)
    assert.equal(deriveTwinThreshold([1, 2, 3, 40], 0), null)
    assert.equal(deriveTwinThreshold([1, 2, 3, 40], -1), null)
  })

  test('non-finite values are ignored rather than poisoning the median', () => {
    assert.equal(
      deriveTwinThreshold([1, 2, 3, 4, 100, NaN, Infinity], 2),
      deriveTwinThreshold([1, 2, 3, 4, 100], 2)
    )
  })
})

describe('buildTwinIndex', () => {
  const pairs: TwinPair[] = [
    pair('alice', 'bob', 0.19),
    pair('alice', 'carol', 0.12),
    pair('alice', 'dave', 0.05),
    pair('erin', 'bob', 0.05),
    pair('erin', 'carol', 0.04),
    pair('frank', 'dave', 0.03),
    pair('frank', 'erin', 0.05),
  ]

  test('carries the shared-title overlap through to the donor', () => {
    // These ids are the only evidence on the insights panel that actually
    // explains a borrowed pick. Dropping them here would leave the panel
    // silently falling back to the similarity carousel, which is exactly the
    // wrong story — so the carry-through is worth pinning even though nothing
    // in the slot arithmetic reads the field.
    const withOverlap: TwinPair = {
      ...pair('alice', 'bob', 0.19),
      sharedTopIds: ['rare-1', 'rare-2'],
    }
    const index = buildTwinIndex([withOverlap, ...pairs.slice(1)], 2)

    assert.deepEqual(index.get('alice')?.[0]?.sharedTopIds, ['rare-1', 'rare-2'])
  })

  test('a pair with no recorded overlap still allocates slots', () => {
    // Display-only data must never be able to cost someone a recommendation.
    const index = buildTwinIndex(pairs, 2)
    const donors = index.get('alice') ?? []

    assert.equal(donors.length, 2)
    assert.equal(donors[0]?.sharedTopIds, undefined)
    assert.equal(computeReservedTwinSlots(20, donors.length, 4), 2)
  })

  test('keeps only pairs above the population bar', () => {
    const index = buildTwinIndex(pairs, 2)
    // median 0.05, MAD 0.01 -> bar 0.07. Only alice's two strongest survive.
    assert.deepEqual([...index.keys()], ['alice'])
    assert.deepEqual(
      index.get('alice')?.map((d) => d.donorId),
      ['bob', 'carol']
    )
  })

  test('k is monotone: loosening the bar never admits fewer pairs', () => {
    // Own fixture, with a pair sitting between the k=1 and k=4 bars so the knob
    // is shown to actually move something rather than merely not regressing.
    const spread: TwinPair[] = [
      pair('alice', 'bob', 0.19),
      pair('alice', 'carol', 0.12),
      pair('alice', 'dave', 0.08),
      pair('erin', 'bob', 0.05),
      pair('erin', 'carol', 0.05),
      pair('frank', 'dave', 0.05),
      pair('frank', 'erin', 0.04),
      pair('gina', 'bob', 0.03),
    ]

    const admitted = (k: number) => [...buildTwinIndex(spread, k).values()].flat().length

    // median 0.05, MAD 0.015 -> bar 0.065 at k=1, 0.11 at k=4.
    assert.equal(admitted(1), 3)
    assert.equal(admitted(4), 2)

    for (let k = 1; k <= 4; k += 0.5) {
      assert.ok(
        admitted(k) <= admitted(1),
        `raising k above 1 must never admit more pairs (failed at k=${k})`
      )
      assert.ok(
        admitted(k) >= admitted(4),
        `lowering k below 4 must never admit fewer pairs (failed at k=${k})`
      )
    }
  })

  test('donors come back strongest first', () => {
    const index = buildTwinIndex([...pairs].reverse(), 2)
    const affinities = index.get('alice')?.map((d) => d.affinity) ?? []
    assert.deepEqual(affinities, [...affinities].sort((a, b) => b - a))
  })

  test('empty input, and a flat distribution, produce no twins', () => {
    assert.equal(buildTwinIndex([], 2).size, 0)
    assert.equal(buildTwinIndex([pair('a', 'b', 0.1), pair('c', 'd', 0.1)], 2).size, 0)
  })
})

describe('computeReservedTwinSlots', () => {
  test('the configured ceiling is what happens, whatever the list length', () => {
    // The regression this guards: a 0.2 share used to sit under the ceiling, so
    // 4 configured against a 10-item list quietly became 2 and the settings
    // page gave no indication why.
    assert.equal(computeReservedTwinSlots(10, 5, 4), 4)
    assert.equal(computeReservedTwinSlots(12, 5, 4), 4)
    assert.equal(computeReservedTwinSlots(20, 5, 4), 4)
    assert.equal(computeReservedTwinSlots(100, 9, 4), 4)
    assert.equal(computeReservedTwinSlots(100, 9, 2), 2)
  })

  test('never more slots than the user has twins', () => {
    assert.equal(computeReservedTwinSlots(50, 1, 4), 1)
  })

  test('0 for the ceiling switches the feature off', () => {
    assert.equal(computeReservedTwinSlots(20, 5, 0), 0)
  })

  test('no twins means no slots and an unchanged pipeline', () => {
    assert.equal(computeReservedTwinSlots(20, 0, 4), 0)
  })

  test('a list shorter than the ceiling is bounded by the list', () => {
    assert.equal(computeReservedTwinSlots(2, 5, 4), 2)
    assert.equal(computeReservedTwinSlots(0, 5, 4), 0)
  })

  test('never exceeds the ceiling, the twins available, or the list itself', () => {
    for (let remaining = 0; remaining <= 60; remaining++) {
      for (let twins = 0; twins <= 6; twins++) {
        for (const cap of [0, 1, 2, 4, 10]) {
          const slots = computeReservedTwinSlots(remaining, twins, cap)
          assert.ok(Number.isInteger(slots) && slots >= 0, 'slots must be a non-negative integer')
          assert.ok(slots <= cap, 'over the admin ceiling')
          assert.ok(slots <= twins, 'more slots than twins')
          assert.ok(remaining - slots >= 0, 'would leave a negative target')
        }
      }
    }
  })

  test('non-finite inputs are refused rather than propagated', () => {
    assert.equal(computeReservedTwinSlots(NaN, 3, 4), 0)
    assert.equal(computeReservedTwinSlots(20, NaN, 4), 0)
    assert.equal(computeReservedTwinSlots(20, 3, NaN), 0)
  })
})

describe('composition with interest slots', () => {
  test('the two features together can never over-reserve the list', () => {
    // Both ceilings are now authoritative, so nothing scales them down against
    // the list any more. What keeps the budget balanced is that the pipelines
    // measure twin slots against what interests left behind -- this sweep is
    // what makes that ordering load-bearing rather than incidental.
    for (let selectedCount = 1; selectedCount <= 60; selectedCount++) {
      for (let interests = 0; interests <= 5; interests++) {
        for (const interestCap of [0, 3, 10]) {
          for (const twinCap of [0, 2, 4, 10]) {
            const interestSlots = computeReservedInterestSlots(
              selectedCount,
              interests,
              interestCap
            )
            const twinSlots = computeReservedTwinSlots(selectedCount - interestSlots, 5, twinCap)
            assert.ok(
              interestSlots + twinSlots <= selectedCount,
              `over-reserved at selectedCount=${selectedCount}, interests=${interests}, caps=${interestCap}/${twinCap}`
            )
          }
        }
      }
    }
  })
})

describe('pickTwinSlotFillers', () => {
  const scored = [
    candidate('m1', 0.9),
    candidate('m2', 0.5),
    candidate('m3', 0.7),
    candidate('m4', 0.8),
    candidate('m5', 0.6),
  ]

  test('ranks by finalScore, not by rarity or set order', () => {
    // The correction that made the feature work: an unwatched candidate almost
    // always has exactly one viewer, so every idf ties and ordering by it is
    // arbitrary. Insertion order here is deliberately the reverse of score
    // order, so a filler that respected the Set would pick m2.
    const watched = new Map([['bob', new Set(['m2', 'm5', 'm1'])]])
    const fillers = pickTwinSlotFillers([], scored, [donor('bob', 0.19)], watched, 1)
    assert.deepEqual(
      fillers.map((f) => f.candidate.id),
      ['m1']
    )
  })

  test('round-robins so one prolific twin cannot take every slot', () => {
    const watched = new Map([
      ['bob', new Set(['m1', 'm4', 'm3'])],
      ['carol', new Set(['m5'])],
    ])
    const fillers = pickTwinSlotFillers(
      [],
      scored,
      [donor('bob', 0.19), donor('carol', 0.12)],
      watched,
      2
    )
    assert.deepEqual(
      fillers.map((f) => [f.twin.donorId, f.candidate.id]),
      [
        ['bob', 'm1'],
        ['carol', 'm5'],
      ]
    )
  })

  test('a second round only starts once every twin has had one', () => {
    const watched = new Map([
      ['bob', new Set(['m1', 'm4'])],
      ['carol', new Set(['m5'])],
    ])
    const fillers = pickTwinSlotFillers(
      [],
      scored,
      [donor('bob', 0.19), donor('carol', 0.12)],
      watched,
      3
    )
    assert.deepEqual(
      fillers.map((f) => f.candidate.id),
      ['m1', 'm5', 'm4']
    )
  })

  test('never re-picks something already selected', () => {
    const watched = new Map([['bob', new Set(['m1', 'm4'])]])
    const fillers = pickTwinSlotFillers([candidate('m1', 0.9)], scored, [donor('bob', 0.19)], watched, 2)
    assert.deepEqual(
      fillers.map((f) => f.candidate.id),
      ['m4']
    )
  })

  test('titles the twin watched that are not in the scored pool are skipped', () => {
    const watched = new Map([['bob', new Set(['not-in-library', 'm2'])]])
    const fillers = pickTwinSlotFillers([], scored, [donor('bob', 0.19)], watched, 2)
    assert.deepEqual(
      fillers.map((f) => f.candidate.id),
      ['m2']
    )
  })

  test('slots with nothing left to fill them are left unused, not padded', () => {
    const watched = new Map([['bob', new Set(['m1'])]])
    const fillers = pickTwinSlotFillers([], scored, [donor('bob', 0.19)], watched, 4)
    assert.equal(fillers.length, 1)
  })

  test('ties break to the lower id, so the same inputs always pick the same title', () => {
    const tied = [candidate('zeta', 0.7), candidate('alpha', 0.7)]
    const watched = new Map([['bob', new Set(['zeta', 'alpha'])]])
    const fillers = pickTwinSlotFillers([], tied, [donor('bob', 0.19)], watched, 1)
    assert.equal(fillers[0].candidate.id, 'alpha')
  })

  test('no slots, no twins, or a donor with no watch set all yield nothing', () => {
    const watched = new Map([['bob', new Set(['m1'])]])
    assert.deepEqual(pickTwinSlotFillers([], scored, [donor('bob', 0.19)], watched, 0), [])
    assert.deepEqual(pickTwinSlotFillers([], scored, [], watched, 2), [])
    assert.deepEqual(pickTwinSlotFillers([], scored, [donor('bob', 0.19)], new Map(), 2), [])
  })
})
