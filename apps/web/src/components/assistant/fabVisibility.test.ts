import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FAB_SCROLL_DEADBAND_PX, FAB_TOP_ZONE_PX, nextFabVisible } from './fabVisibility.js'

describe('nextFabVisible', () => {
  it('hides when scrolling down and returns when scrolling up', () => {
    assert.equal(nextFabVisible(true, 500, 600), false)
    assert.equal(nextFabVisible(false, 600, 500), true)
  })

  it('ignores jitter smaller than the deadband either way', () => {
    const small = FAB_SCROLL_DEADBAND_PX - 1
    assert.equal(nextFabVisible(true, 500, 500 + small), true)
    assert.equal(nextFabVisible(false, 500, 500 - small), false)
  })

  it('always shows near the top of the page', () => {
    assert.equal(nextFabVisible(false, 0, FAB_TOP_ZONE_PX), true)
    // Even when that last move was downwards.
    assert.equal(nextFabVisible(false, 10, FAB_TOP_ZONE_PX - 1), true)
  })
})
