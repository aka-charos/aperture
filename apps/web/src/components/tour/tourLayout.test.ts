import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOCK_FREE_SHARE, DOCK_SCROLL_GAP, dockEdge, dockLanding, dockScrollOffset } from './tourLayout'

const VIEWPORT = 800
const CHROME = 56

test('an element already whole in the upper part of the screen is not scrolled', () => {
  assert.equal(dockScrollOffset({ top: 120, height: 200 }, VIEWPORT, CHROME, false), null)
})

test('an element reaching into the lower half is scrolled up to just under the app bar', () => {
  assert.equal(dockScrollOffset({ top: 500, height: 200 }, VIEWPORT, CHROME, false), 500 - (CHROME + DOCK_SCROLL_GAP))
})

test('an element taller than the screen is scrolled so its start shows', () => {
  assert.equal(dockScrollOffset({ top: 300, height: 1600 }, VIEWPORT, CHROME, false), 300 - (CHROME + DOCK_SCROLL_GAP))
})

test('an element above the screen, or under the app bar, is scrolled down into view', () => {
  assert.equal(dockScrollOffset({ top: -400, height: 100 }, VIEWPORT, CHROME, false), -400 - (CHROME + DOCK_SCROLL_GAP))
  assert.equal(dockScrollOffset({ top: 20, height: 100 }, VIEWPORT, CHROME, false), 20 - (CHROME + DOCK_SCROLL_GAP))
})

test('an element that cannot move is never scrolled', () => {
  // The search and help buttons sit in the fixed app bar.
  assert.equal(dockScrollOffset({ top: 8, height: 40 }, VIEWPORT, CHROME, true), null)
})

test('the card docks at the bottom unless the element starts in the lower half', () => {
  // A button in the app bar.
  assert.equal(dockEdge({ top: 8, height: 40 }, VIEWPORT, CHROME), 'bottom')
  // Taller than the screen, scrolled to its start: the card must not cover that start.
  assert.equal(dockEdge({ top: CHROME + DOCK_SCROLL_GAP, height: 1600 }, VIEWPORT, CHROME), 'bottom')
  assert.equal(dockEdge({ top: CHROME + 100, height: VIEWPORT - CHROME - 200 }, VIEWPORT, CHROME), 'bottom')
  // Something that stays low on the screen.
  assert.equal(dockEdge({ top: 700, height: 60 }, VIEWPORT, CHROME), 'top')
})

test('an element lands where the scroll takes it, never past the end of the page', () => {
  const box = { top: 700, height: 80 }
  const offset = dockScrollOffset(box, VIEWPORT, CHROME, false)
  // Plenty of page below: it lands just under the app bar.
  assert.deepEqual(dockLanding(box, offset, { up: 0, down: 5000 }), { top: CHROME + DOCK_SCROLL_GAP, height: 80 })
  // The page ends 100px below: it moves up 100px and stays low, so the card docks on top.
  const landed = dockLanding(box, offset, { up: 0, down: 100 })
  assert.deepEqual(landed, { top: 600, height: 80 })
  assert.equal(dockEdge(landed, VIEWPORT, CHROME), 'top')
  // Not scrolled at all.
  assert.deepEqual(dockLanding(box, null, { up: 0, down: 5000 }), box)
})

test('an element above the screen cannot be scrolled past the top of the page', () => {
  const box = { top: -400, height: 100 }
  const offset = dockScrollOffset(box, VIEWPORT, CHROME, false)
  assert.deepEqual(dockLanding(box, offset, { up: 300, down: 0 }), { top: -100, height: 100 })
})

test('an element judged to fit above the card ends where the bottom-docked card begins', () => {
  // The card is capped at the rest of the screen, so an element reaching
  // exactly to the free share is not scrolled and is not covered.
  const reach = VIEWPORT * DOCK_FREE_SHARE
  assert.equal(dockScrollOffset({ top: 100, height: reach - 100 }, VIEWPORT, CHROME, false), null)
})
