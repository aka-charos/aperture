import test from 'node:test'
import assert from 'node:assert/strict'
import { seerrSeasonStatuses } from './seasonStatus.js'
import type { SeerrMediaInfo } from './types.js'

function info(partial: Partial<SeerrMediaInfo>): SeerrMediaInfo {
  return { id: 1, tmdbId: 1, status: 1, mediaType: 'tv', ...partial }
}

test('a show Seerr has never seen says nothing about any season', () => {
  assert.equal(seerrSeasonStatuses(undefined).size, 0)
  assert.equal(seerrSeasonStatuses(info({})).size, 0)
})

test('season rows read like the movie statuses, and partly available counts as available', () => {
  const statuses = seerrSeasonStatuses(
    info({
      seasons: [
        { seasonNumber: 1, status: 5 },
        { seasonNumber: 2, status: 4 },
        { seasonNumber: 3, status: 3 },
        { seasonNumber: 4, status: 2 },
        { seasonNumber: 5, status: 1 },
        { seasonNumber: 6, status: 7 },
      ],
    })
  )
  assert.equal(statuses.get(1), 'available')
  assert.equal(statuses.get(2), 'available')
  assert.equal(statuses.get(3), 'processing')
  assert.equal(statuses.get(4), 'requested')
  assert.equal(statuses.has(5), false)
  assert.equal(statuses.has(6), false)
})

test('a season held only in 4K is still in Seerr', () => {
  const statuses = seerrSeasonStatuses(info({ seasons: [{ seasonNumber: 1, status: 1, status4k: 5 }] }))
  assert.equal(statuses.get(1), 'available')
})

test('an open request holds its seasons before any season row moves', () => {
  const request = (status: number, seasons: number[]) =>
    ({ status, seasons: seasons.map((seasonNumber) => ({ seasonNumber })) }) as never
  const statuses = seerrSeasonStatuses(
    info({
      requests: [request(1, [2]), request(2, [3]), request(4, [4]), request(3, [5]), request(5, [6])],
    })
  )
  assert.equal(statuses.get(2), 'requested')
  assert.equal(statuses.get(3), 'requested')
  assert.equal(statuses.get(4), 'requested', 'Seerr still refuses a season whose request failed')
  assert.equal(statuses.has(5), false, 'a declined request frees its season')
  assert.equal(statuses.has(6), false, 'a completed request frees its season')
})

test('the further-along answer wins, whichever field it came from', () => {
  const statuses = seerrSeasonStatuses(
    info({
      seasons: [{ seasonNumber: 1, status: 3 }],
      requests: [{ status: 2, seasons: [{ seasonNumber: 1 }] } as never],
    })
  )
  assert.equal(statuses.get(1), 'processing')
})
