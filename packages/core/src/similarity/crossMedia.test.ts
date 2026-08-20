import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CROSS_MEDIA_SHARE, crossMediaSlots, selectWithCrossMediaSlots } from './crossMedia.js'

interface Item {
  id: string
  cross: boolean
}

const isCross = (item: Item) => item.cross

/** `n` same-media items followed by `m` cross-media ones, ids s0.. / c0.. */
function pool(same: number, cross: number): Item[] {
  return [
    ...Array.from({ length: same }, (_, i) => ({ id: `s${i}`, cross: false })),
    ...Array.from({ length: cross }, (_, i) => ({ id: `c${i}`, cross: true })),
  ]
}

const ids = (items: Item[]) => items.map((item) => item.id)

describe('crossMediaSlots', () => {
  it('reserves one slot at the size the graph actually renders', () => {
    // getGraphForSource shows three connections per node. If this returned 0
    // the whole feature would be invisible on the Explore page.
    assert.equal(crossMediaSlots(3), 1)
  })

  it('never hands over more than half the list', () => {
    assert.equal(crossMediaSlots(1), 0)
    assert.equal(crossMediaSlots(2), 1)
  })

  it('scales with the share at larger limits', () => {
    assert.equal(crossMediaSlots(12), Math.round(12 * CROSS_MEDIA_SHARE))
    assert.equal(crossMediaSlots(20), Math.round(20 * CROSS_MEDIA_SHARE))
  })

  it('reserves nothing for a limit that cannot hold anything', () => {
    assert.equal(crossMediaSlots(0), 0)
    assert.equal(crossMediaSlots(-4), 0)
    assert.equal(crossMediaSlots(Number.NaN), 0)
  })
})

describe('selectWithCrossMediaSlots', () => {
  it('admits a cross-media item that raw ranking would have dropped', () => {
    // The whole point: every same-media candidate outranks every cross-media
    // one, which is the shape a merged ORDER BY produces when the two distance
    // populations differ. Without a reservation nothing cross-media survives.
    const selected = selectWithCrossMediaSlots(pool(6, 3), isCross, 3)
    assert.deepEqual(ids(selected), ['s0', 's1', 'c0'])
  })

  it('returns the caller ordering, not selection order', () => {
    const candidates: Item[] = [
      { id: 'a', cross: true },
      { id: 'b', cross: false },
      { id: 'c', cross: false },
      { id: 'd', cross: false },
    ]
    // 'a' is reserved-slot filled first but must still come back first.
    assert.deepEqual(ids(selectWithCrossMediaSlots(candidates, isCross, 3)), ['a', 'b', 'c'])
  })

  it('gives unfilled reserved slots back to same-media', () => {
    const selected = selectWithCrossMediaSlots(pool(6, 0), isCross, 3)
    assert.deepEqual(ids(selected), ['s0', 's1', 's2'])
  })

  it('tops up from cross-media when same-media runs out', () => {
    const selected = selectWithCrossMediaSlots(pool(1, 6), isCross, 3)
    assert.deepEqual(ids(selected), ['s0', 'c0', 'c1'])
  })

  it('never shortens the list, whatever the mix', () => {
    for (let same = 0; same <= 8; same++) {
      for (let cross = 0; cross <= 8; cross++) {
        for (let limit = 1; limit <= 6; limit++) {
          const candidates = pool(same, cross)
          const selected = selectWithCrossMediaSlots(candidates, isCross, limit)
          assert.equal(
            selected.length,
            Math.min(limit, candidates.length),
            `same=${same} cross=${cross} limit=${limit}`
          )
          // Selection only, no duplication.
          assert.equal(new Set(ids(selected)).size, selected.length)
        }
      }
    }
  })

  it('passes short pools straight through', () => {
    const candidates = pool(2, 0)
    assert.deepEqual(ids(selectWithCrossMediaSlots(candidates, isCross, 5)), ['s0', 's1'])
  })

  it('selects nothing for a non-positive limit', () => {
    assert.deepEqual(selectWithCrossMediaSlots(pool(4, 4), isCross, 0), [])
  })
})
