import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWithinUpcomingHorizon, upcomingHorizonDate } from './upcomingHorizon.js'

const now = new Date('2026-10-14T09:00:00Z')
const horizon = upcomingHorizonDate(now)

test('the horizon is two calendar months out', () => {
  assert.equal(upcomingHorizonDate(now), '2026-12-14')
})

test('month-end clamps instead of rolling into the following month', () => {
  assert.equal(upcomingHorizonDate(new Date('2026-12-31T12:00:00Z')), '2027-02-28')
  assert.equal(upcomingHorizonDate(new Date('2027-12-31T12:00:00Z')), '2028-02-29')
})

test('episodes inside the horizon are shown, the horizon day included', () => {
  assert.equal(isWithinUpcomingHorizon('2026-10-20', horizon), true)
  assert.equal(isWithinUpcomingHorizon('2026-12-14', horizon), true)
  assert.equal(isWithinUpcomingHorizon(new Date('2026-11-01T00:00:00Z'), horizon), true)
})

test('a premiere months away is not', () => {
  assert.equal(isWithinUpcomingHorizon('2026-12-15', horizon), false)
  assert.equal(isWithinUpcomingHorizon('2027-07-10', horizon), false)
})

test('an unreadable date is kept, not hidden', () => {
  assert.equal(isWithinUpcomingHorizon('not a date', horizon), true)
})
