import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeCode, formatAirDay, latestAiredKey, nextDateKey } from './upcomingText'

const next = { season: 2, number: 5, title: 'x', airDate: '2026-11-20', basis: 'tmdbForecast' as const }
const latest = { season: 2, number: 4, title: 'x', airDate: '2026-10-30' }

test('an expected date never reads as anything firmer', () => {
  assert.equal(nextDateKey({ ...next, status: 'expected' }), 'upcomingExpected')
  // The server path gives the same wording: a listing is not a file.
  assert.equal(nextDateKey({ ...next, status: 'expected', basis: 'serverListing' }), 'upcomingExpected')
  assert.equal(nextDateKey({ ...next, status: 'pastDue' }), 'upcomingPastDue')
})

test('only an episode the server holds is called in your library', () => {
  assert.equal(latestAiredKey({ ...latest, inLibrary: false, played: false }), 'upcomingLatestNotInLibrary')
  assert.equal(latestAiredKey({ ...latest, inLibrary: true, played: false }), 'upcomingLatestUnplayed')
  assert.equal(latestAiredKey({ ...latest, inLibrary: true, played: true }), 'upcomingLatestInLibrary')
})

test('a day stays that day whatever the viewer clock', () => {
  const original = process.env.TZ
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
    process.env.TZ = zone
    assert.match(formatAirDay('2026-11-20', 'en-US'), /Nov 20, 2026/, zone)
  }
  if (original === undefined) delete process.env.TZ
  else process.env.TZ = original
})

test('an unreadable date is shown as sent rather than as Invalid Date', () => {
  assert.equal(formatAirDay('soon', 'en-US'), 'soon')
})

test('the episode code matches the Watching page', () => {
  assert.equal(episodeCode(2, 5), 'S02E05')
  assert.equal(episodeCode(12, 105), 'S12E105')
})
