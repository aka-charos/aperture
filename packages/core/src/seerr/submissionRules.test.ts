import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CONFIRM_CLOCK_SLACK_MS,
  UNCONFIRMED_GIVE_UP_MS,
  decideTitleRows,
  decideUnconfirmed,
  findSubmittedRequest,
  isUncertainCreateFailure,
  type SeerrRequestTrace,
} from './submissionRules.js'

const since = new Date('2026-11-09T12:00:00Z')
const at = (offsetMs: number) => new Date(since.getTime() + offsetMs).toISOString()
const trace = (over: Partial<SeerrRequestTrace> = {}): SeerrRequestTrace => ({
  id: 10,
  createdAt: at(1000),
  requestedById: 7,
  is4k: false,
  seasons: null,
  ...over,
})
const query = (over: Partial<Parameters<typeof findSubmittedRequest>[1]> = {}) => ({
  since,
  requesterSeerrId: 7,
  seasons: null,
  recordedIds: new Set<number>(),
  ...over,
})

test('no status or a 5xx may have made the request; a 4xx is an answer', () => {
  assert.equal(isUncertainCreateFailure(null), true)
  assert.equal(isUncertainCreateFailure(undefined), true)
  assert.equal(isUncertainCreateFailure(500), true)
  assert.equal(isUncertainCreateFailure(504), true)
  assert.equal(isUncertainCreateFailure(409), false)
  assert.equal(isUncertainCreateFailure(403), false)
  assert.equal(isUncertainCreateFailure(400), false)
})

test('a request by our Seerr user dated from our send is ours', () => {
  assert.equal(findSubmittedRequest([trace()], query())?.id, 10)
})

test('clock slack: a request dated a little before our send still counts, much earlier does not', () => {
  assert.equal(findSubmittedRequest([trace({ createdAt: at(-CONFIRM_CLOCK_SLACK_MS + 1000) })], query())?.id, 10)
  assert.equal(findSubmittedRequest([trace({ createdAt: at(-CONFIRM_CLOCK_SLACK_MS - 1000) })], query()), null)
})

test('a request another Aperture row already records is not ours', () => {
  assert.equal(findSubmittedRequest([trace()], query({ recordedIds: new Set([10]) })), null)
})

test('someone else\'s request is not ours when we know who we sent it as', () => {
  assert.equal(findSubmittedRequest([trace({ requestedById: 8 })], query()), null)
  // Sent as the API key owner, whose Seerr id we do not know: anyone's counts.
  assert.equal(findSubmittedRequest([trace({ requestedById: 8 })], query({ requesterSeerrId: null }))?.id, 10)
})

test('a request Seerr lists without its requester is unknown, so it can be ours', () => {
  assert.equal(findSubmittedRequest([trace({ requestedById: null })], query())?.id, 10)
})

test('quality must match when known', () => {
  assert.equal(findSubmittedRequest([trace({ is4k: true })], query({ is4k: false })), null)
  assert.equal(findSubmittedRequest([trace({ is4k: true })], query())?.id, 10)
})

test('a TV request must cover a season we asked for', () => {
  assert.equal(findSubmittedRequest([trace({ seasons: [3] })], query({ seasons: [1, 2] })), null)
  assert.equal(findSubmittedRequest([trace({ seasons: [2, 3] })], query({ seasons: [1, 2] }))?.id, 10)
  // Seerr listed no seasons, or we asked for the whole show: nothing to compare.
  assert.equal(findSubmittedRequest([trace({ seasons: null })], query({ seasons: [1] }))?.id, 10)
  assert.equal(findSubmittedRequest([trace({ seasons: [3] })], query({ seasons: null }))?.id, 10)
})

test('of several that fit, the earliest is ours', () => {
  const found = findSubmittedRequest(
    [trace({ id: 12, createdAt: at(9000) }), trace({ id: 11, createdAt: at(2000) })],
    query()
  )
  assert.equal(found?.id, 11)
})

test('an unreadable date is not ours', () => {
  assert.equal(findSubmittedRequest([trace({ createdAt: 'never' })], query()), null)
})

test('found is confirmed; an unreadable Seerr decides nothing', () => {
  const now = new Date(since.getTime() + UNCONFIRMED_GIVE_UP_MS * 2)
  assert.equal(decideUnconfirmed({ lookupOk: true, found: true, since, now, final: false }), 'confirmed')
  assert.equal(decideUnconfirmed({ lookupOk: false, found: false, since, now, final: true }), 'waiting')
})

test('not found is absent past the give-up time, or when the person asks again', () => {
  const early = new Date(since.getTime() + 1000)
  const late = new Date(since.getTime() + UNCONFIRMED_GIVE_UP_MS)
  assert.equal(decideUnconfirmed({ lookupOk: true, found: false, since, now: early, final: false }), 'waiting')
  assert.equal(decideUnconfirmed({ lookupOk: true, found: false, since, now: late, final: false }), 'absent')
  assert.equal(decideUnconfirmed({ lookupOk: true, found: false, since, now: early, final: true }), 'absent')
})

test('two unanswered rows of one title never claim the same Seerr request', () => {
  const rows = [
    { id: 'b', since: new Date(since.getTime() + 60_000), requesterSeerrId: 7, seasons: null },
    { id: 'a', since, requesterSeerrId: 7, seasons: null },
  ]
  const decided = decideTitleRows(rows, [trace({ id: 10, createdAt: at(61_000) })], new Set(), {
    now: new Date(since.getTime() + 1000),
    final: true,
  })
  // Oldest first takes it; the other finds nothing left and is absent.
  assert.deepEqual(decided, [
    { id: 'a', outcome: 'confirmed', seerrRequestId: 10 },
    { id: 'b', outcome: 'absent' },
  ])
})

test('an unreadable Seerr leaves every row of the title waiting', () => {
  const decided = decideTitleRows([{ id: 'a', since, requesterSeerrId: null, seasons: null }], null, new Set(), {
    now: new Date(since.getTime() + UNCONFIRMED_GIVE_UP_MS * 2),
    final: true,
  })
  assert.deepEqual(decided, [{ id: 'a', outcome: 'waiting' }])
})
