/**
 * Pins the band ladder.
 *
 * Every failure this guards against is silent. A band offered that predates
 * the film reads as a normal option; a midpoint landing a day out is
 * indistinguishable from a correct one; a date in the future sorts to the top
 * of the taste history forever and shows up nowhere as an error. None of it
 * would be caught by a typecheck, a lint or a glance at the UI.
 *
 * `now` is fixed at 09:00 on 5 September 2026 throughout — a Saturday early in
 * a month, so "this month" is a short band and midday on its midpoint is still
 * behind `now`. Where a case needs the opposite (a midpoint that would land in
 * the future) it says so.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  WATCH_DATE_BANDS,
  availableWatchDateBands,
  resolveWatchDate,
  isWatchDateBand,
} from './watchDateBands.js'

const NOW = new Date(2026, 8, 5, 9, 0, 0)

/** Local `YYYY-MM-DD HH:mm`, so a failure names a date rather than an epoch. */
const stamp = (d: Date | null) =>
  d === null
    ? 'null'
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
        d.getMinutes()
      ).padStart(2, '0')}`

describe('availableWatchDateBands', () => {
  test('an old film keeps the whole ladder', () => {
    // The correction that matters: a release date clamps from below only. A
    // 1998 film is exactly the sort of thing someone watches this month.
    assert.deepEqual(availableWatchDateBands(NOW, new Date(1998, 4, 20)), [...WATCH_DATE_BANDS])
  })

  test('no release date rules nothing out', () => {
    assert.deepEqual(availableWatchDateBands(NOW, null), [...WATCH_DATE_BANDS])
  })

  test('a film from earlier this year loses the two oldest bands', () => {
    assert.deepEqual(availableWatchDateBands(NOW, new Date(2026, 1, 12)), [
      'thisMonth',
      'lastMonth',
      'earlierThisYear',
    ])
  })

  test('a film released last month cannot have been watched before it', () => {
    assert.deepEqual(availableWatchDateBands(NOW, new Date(2026, 7, 20)), [
      'thisMonth',
      'lastMonth',
    ])
  })

  test('a film released days ago collapses to a single band', () => {
    // The caller turns this into a yes/no rather than a ladder — and must not
    // silently mark it watched, because writing to someone's media server is
    // not something a rating asked for.
    assert.deepEqual(availableWatchDateBands(NOW, new Date(2026, 8, 2)), ['thisMonth'])
  })

  test('an unreleased title offers nothing at all', () => {
    // In the library but not yet out. The caller must not prompt.
    assert.deepEqual(availableWatchDateBands(NOW, new Date(2026, 10, 1)), [])
  })

  test('a film released last year keeps last year but not longer ago', () => {
    assert.deepEqual(availableWatchDateBands(NOW, new Date(2025, 5, 1)), [
      'thisMonth',
      'lastMonth',
      'earlierThisYear',
      'lastYear',
    ])
  })
})

describe('resolveWatchDate', () => {
  test('each band writes the midpoint of its own span, at midday', () => {
    const old = new Date(1998, 4, 20)
    assert.equal(stamp(resolveWatchDate('thisMonth', NOW, old)), '2026-09-03 12:00')
    assert.equal(stamp(resolveWatchDate('lastMonth', NOW, old)), '2026-08-16 12:00')
    assert.equal(stamp(resolveWatchDate('earlierThisYear', NOW, old)), '2026-04-16 12:00')
    assert.equal(stamp(resolveWatchDate('lastYear', NOW, old)), '2025-07-02 12:00')
    assert.equal(stamp(resolveWatchDate('longerAgo', NOW, old)), '2024-01-01 12:00')
  })

  test('the release date clamps a band that starts before it', () => {
    // "Earlier this year" for a film released in July means July onward, not
    // January — so the same answer writes different dates for different films.
    const july = new Date(2026, 6, 10)
    assert.equal(stamp(resolveWatchDate('earlierThisYear', NOW, july)), '2026-07-20 12:00')
  })

  test('an unavailable band writes nothing rather than a date nobody meant', () => {
    assert.equal(resolveWatchDate('lastYear', NOW, new Date(2026, 1, 12)), null)
    assert.equal(resolveWatchDate('longerAgo', NOW, new Date(2026, 1, 12)), null)
  })

  test('a midpoint is never allowed into the future', () => {
    // On the 1st, "this month" is a single day and its midday is still ahead
    // of someone rating at 09:00. A future last_played_at sorts to the top of
    // the taste history permanently and falls outside every "last N days"
    // window.
    const firstOfMonth = new Date(2026, 8, 1, 9, 0, 0)
    const resolved = resolveWatchDate('thisMonth', firstOfMonth, null)
    assert.ok(resolved !== null)
    assert.ok(
      resolved.getTime() <= firstOfMonth.getTime(),
      `expected <= now, got ${stamp(resolved)}`
    )
  })

  test('the oldest band always clears the 360-day recency floor', () => {
    // The whole reason `longerAgo` needs no precision: past 360 days the taste
    // weight is pinned at 0.25, so any older date is identical to any other.
    // Checked on the 2nd of January, which is where that margin is thinnest.
    const earlyJanuary = new Date(2026, 0, 2, 9, 0, 0)
    const resolved = resolveWatchDate('longerAgo', earlyJanuary, null)
    assert.ok(resolved !== null)
    const days = (earlyJanuary.getTime() - resolved.getTime()) / 86_400_000
    assert.ok(days >= 360, `expected >= 360 days back, got ${Math.round(days)}`)
  })

  test('bands do not overlap, so one day has one answer', () => {
    // Overlapping bands would make two different answers write the same date,
    // and the viewer's actual choice would stop meaning anything.
    const dates = WATCH_DATE_BANDS.map((b) => resolveWatchDate(b, NOW, null))
    for (const d of dates) assert.ok(d !== null)
    const times = dates.map((d) => d!.getTime())
    assert.deepEqual(times, [...times].sort((a, b) => b - a), 'bands must be newest-first')
    assert.equal(new Set(times).size, times.length, 'two bands resolved to the same instant')
  })
})

describe('isWatchDateBand', () => {
  test('accepts the ladder and refuses anything else', () => {
    for (const band of WATCH_DATE_BANDS) assert.equal(isWatchDateBand(band), true)
    assert.equal(isWatchDateBand('yesterday'), false)
    assert.equal(isWatchDateBand(''), false)
    assert.equal(isWatchDateBand(undefined), false)
    assert.equal(isWatchDateBand(null), false)
  })
})
