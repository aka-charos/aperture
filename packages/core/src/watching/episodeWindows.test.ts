import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRecentlyAired,
  isWithinUpcomingHorizon,
  pickLatestAired,
  recentlyAiredSinceDate,
  upcomingHorizonDate,
  wasCaughtUp,
  type AiredEpisode,
  type SeasonProgress,
} from './episodeWindows.js'

const seasons = (entries: [number, number | null, number | null][]) =>
  new Map<number, SeasonProgress>(
    entries.map(([season, serverLastEpisode, playedLastEpisode]) => [
      season,
      { serverLastEpisode, playedLastEpisode },
    ])
  )

test('finished the previous season, the new one just aired: caught up', () => {
  assert.equal(wasCaughtUp(4, seasons([[1, 8, 8], [2, 8, 8], [3, 10, 10]])), true)
})

test('stopped in season 1, season 4 just aired: not caught up', () => {
  assert.equal(wasCaughtUp(4, seasons([[1, 8, 3], [2, 8, null], [3, 10, null]])), false)
})

test('part-way through the previous season is not finished', () => {
  assert.equal(wasCaughtUp(4, seasons([[3, 10, 9]])), false)
})

test('already watching the latest season counts, however far in', () => {
  assert.equal(wasCaughtUp(4, seasons([[3, 10, 10], [4, 8, 1]])), true)
})

test('a previous season the server lacks cannot have been finished', () => {
  assert.equal(wasCaughtUp(4, seasons([[2, 8, 8]])), false)
  assert.equal(wasCaughtUp(4, undefined), false)
})

test('a new show premiering needs nothing before it', () => {
  assert.equal(wasCaughtUp(1, undefined), true)
  assert.equal(wasCaughtUp(1, seasons([[1, 8, null]])), true)
})

test('specials played do not count as being in the latest season', () => {
  assert.equal(wasCaughtUp(4, seasons([[0, 3, 3], [3, 10, 5]])), false)
})

const now = new Date('2026-10-14T09:00:00Z')
const today = '2026-10-14'
const horizon = upcomingHorizonDate(now)
const since = recentlyAiredSinceDate(now)

test('the horizon is two calendar months out, the recent window two months back', () => {
  assert.equal(horizon, '2026-12-14')
  assert.equal(since, '2026-08-14')
})

test('month-end clamps instead of rolling into the following month', () => {
  assert.equal(upcomingHorizonDate(new Date('2026-12-31T12:00:00Z')), '2027-02-28')
  assert.equal(upcomingHorizonDate(new Date('2027-12-31T12:00:00Z')), '2028-02-29')
  assert.equal(recentlyAiredSinceDate(new Date('2026-04-30T12:00:00Z')), '2026-02-28')
  assert.equal(recentlyAiredSinceDate(new Date('2026-01-15T12:00:00Z')), '2025-11-15')
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

test('an unreadable upcoming date is kept, not hidden', () => {
  assert.equal(isWithinUpcomingHorizon('not a date', horizon), true)
})

test('recently aired covers the window back to today, both ends included', () => {
  assert.equal(isRecentlyAired('2026-08-14', since, today), true)
  assert.equal(isRecentlyAired('2026-10-14', since, today), true)
  assert.equal(isRecentlyAired('2026-08-13', since, today), false)
  assert.equal(isRecentlyAired('2026-10-15', since, today), false)
})

test('an unreadable aired date adds nothing', () => {
  assert.equal(isRecentlyAired('not a date', since, today), false)
})

const ep = (over: Partial<AiredEpisode>): AiredEpisode => ({
  seasonNumber: 3,
  episodeNumber: 10,
  title: 'Finale',
  airDate: '2026-09-01',
  source: 'emby',
  ...over,
})

test('pickLatestAired takes the later date from either side', () => {
  const emby = ep({ airDate: '2026-05-01' })
  const tmdb = ep({ seasonNumber: 4, episodeNumber: 8, airDate: '2026-09-20', source: 'tmdb' })
  assert.equal(pickLatestAired(emby, tmdb), tmdb)
  assert.equal(pickLatestAired(tmdb, null), tmdb)
  assert.equal(pickLatestAired(null, emby), emby)
  assert.equal(pickLatestAired(null, null), null)
})

test('on the same day the later episode wins, and a full tie keeps the server copy', () => {
  const emby = ep({ episodeNumber: 1 })
  const tmdb = ep({ episodeNumber: 8, source: 'tmdb' })
  assert.equal(pickLatestAired(emby, tmdb), tmdb)
  const same = ep({ source: 'tmdb' })
  assert.equal(pickLatestAired(ep({}), same)?.source, 'emby')
})
