import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rowOf, toggleRow } from './rowExpansion.js'

const grid = [
  { id: 'a', top: 100 },
  { id: 'b', top: 100.4 },
  { id: 'c', top: 100 },
  { id: 'd', top: 520 },
  { id: 'e', top: 520 },
]

describe('rowOf', () => {
  it('returns the cards sharing a top edge, sub-pixel differences included', () => {
    assert.deepEqual(rowOf(grid, 'b'), ['a', 'b', 'c'])
    assert.deepEqual(rowOf(grid, 'e'), ['d', 'e'])
  })

  it('falls back to the card alone when it was not measured', () => {
    assert.deepEqual(rowOf(grid, 'zz'), ['zz'])
  })
})

describe('toggleRow', () => {
  it('opens the whole row from a closed card', () => {
    assert.deepEqual([...toggleRow(new Set(), ['a', 'b', 'c'], 'b')].sort(), ['a', 'b', 'c'])
  })

  it('closes the whole row from an open card, leaving other rows alone', () => {
    const next = toggleRow(new Set(['a', 'b', 'c', 'd']), ['a', 'b', 'c'], 'a')
    assert.deepEqual([...next], ['d'])
  })

  it("follows the pressed card's state when a resize mixed open and closed cards in one row", () => {
    const opened = toggleRow(new Set(['a']), ['a', 'd'], 'd')
    assert.deepEqual([...opened].sort(), ['a', 'd'])
    const closed = toggleRow(new Set(['a']), ['a', 'd'], 'a')
    assert.deepEqual([...closed], [])
  })

  it('does not mutate the set it was given', () => {
    const before = new Set(['x'])
    toggleRow(before, ['a'], 'a')
    assert.deepEqual([...before], ['x'])
  })
})
