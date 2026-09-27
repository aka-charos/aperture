import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unnamedCount, watcherLabel } from './watcherNames'

test('unnamedCount is the difference, never negative', () => {
  assert.equal(unnamedCount(5, 2), 3)
  assert.equal(unnamedCount(2, 2), 0)
  // A favorited-count is a floor: a connection who favorited without playing
  // is on neither side, so named can exceed what the total implies.
  assert.equal(unnamedCount(1, 3), 0)
  assert.equal(unnamedCount(Number.NaN, 1), 0)
})

test('watcherLabel names the viewer "You" and everyone else by name', () => {
  const you = 'You'
  assert.equal(watcherLabel({ userId: 'me', name: 'Alex' }, 'me', you), 'You')
  assert.equal(watcherLabel({ userId: 'tom', name: 'Tom' }, 'me', you), 'Tom')
  assert.equal(watcherLabel({ userId: 'tom', name: 'Tom' }, null, you), 'Tom')
  assert.equal(watcherLabel({ userId: 'tom', name: 'Tom' }, undefined, you), 'Tom')
})
