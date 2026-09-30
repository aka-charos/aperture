import test from 'node:test'
import assert from 'node:assert/strict'
import { fitCarouselItems } from './fit.js'

const GAP = 16
const MIN = 150

/** Items plus gaps must never overrun the row, or the next item's edge shows. */
function assertFills(width: number) {
  const fit = fitCarouselItems(width, MIN, GAP)
  assert.ok(fit, `no fit for ${width}`)
  const used = fit.count * fit.itemWidth + (fit.count - 1) * GAP
  assert.ok(used <= width, `${width}px: ${fit.count} × ${fit.itemWidth} overruns (${used})`)
  assert.ok(width - used < fit.count * 0.01 + 1e-9, `${width}px: leaves ${width - used}px unused`)
  return fit
}

test('a phone-width row fits two whole posters', () => {
  assert.equal(assertFills(328).count, 2)
})

test('the reported window (about 612px of row) fits exactly three', () => {
  const fit = assertFills(612)
  assert.equal(fit.count, 3)
  assert.equal(fit.itemWidth, 193.33)
})

test('a desktop row fits many, never below the minimum width', () => {
  for (const width of [900, 1040, 1400, 1920]) {
    const fit = assertFills(width)
    assert.ok(fit.itemWidth >= MIN, `${width}px: ${fit.itemWidth} < ${MIN}`)
    // One more would not fit at the minimum, so the count is the most that does.
    assert.ok((fit.count + 1) * MIN + fit.count * GAP > width)
  }
})

test('the count changes exactly at the boundary', () => {
  // Three minimum items and two gaps is 482px.
  assert.equal(fitCarouselItems(482, MIN, GAP)?.count, 3)
  assert.equal(fitCarouselItems(481, MIN, GAP)?.count, 2)
})

test('a row narrower than one item still shows one, at the row width', () => {
  assert.deepEqual(fitCarouselItems(120, MIN, GAP), { count: 1, itemWidth: 120 })
})

test('nothing to measure yet is null, never zero items', () => {
  assert.equal(fitCarouselItems(0, MIN, GAP), null)
  assert.equal(fitCarouselItems(Number.NaN, MIN, GAP), null)
  assert.equal(fitCarouselItems(600, 0, GAP), null)
})
