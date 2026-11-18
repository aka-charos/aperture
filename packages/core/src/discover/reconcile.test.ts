import test from 'node:test'
import assert from 'node:assert/strict'
import { planLiveRecord, recheckWindow, resolveRequestStatus, restoreKeepsStatusStamp } from './reconcile.js'

/**
 * The point of reconciliation is that a request Seerr declined must reach a
 * TERMINAL status, because getRequestedTmdbIds excludes every non-terminal
 * request from discovery -- so a request stuck at 'submitted' suppresses its
 * title forever.
 */

test('a decline in Seerr becomes declined, so the title can be suggested again', () => {
  assert.equal(
    resolveRequestStatus('submitted', { status: 'declined', mediaStatus: 'unknown' }),
    'declined'
  )
})

test('media availability outranks request state', () => {
  // An approved request whose media has finished importing is 'available', and
  // that is the more useful fact to record.
  assert.equal(
    resolveRequestStatus('approved', { status: 'approved', mediaStatus: 'available' }),
    'available'
  )
  // Even a still-pending request can have available media (someone else asked
  // for the same title first).
  assert.equal(
    resolveRequestStatus('submitted', { status: 'pending', mediaStatus: 'available' }),
    'available'
  )
})

test('approval is recorded', () => {
  assert.equal(
    resolveRequestStatus('submitted', { status: 'approved', mediaStatus: 'processing' }),
    'approved'
  )
})

test('a still-pending request never walks backwards', () => {
  // 'submitted' is our own word for Seerr's 'pending', so seeing 'pending'
  // again must not undo it -- an oscillating status would rewrite updated_at on
  // every sweep and make the reconcile log unreadable.
  assert.equal(
    resolveRequestStatus('submitted', { status: 'pending', mediaStatus: 'pending' }),
    'submitted'
  )
  assert.equal(
    resolveRequestStatus('approved', { status: 'pending', mediaStatus: 'processing' }),
    'approved'
  )
})

test('a fresh pending row advances to submitted once Seerr acknowledges it', () => {
  assert.equal(
    resolveRequestStatus('pending', { status: 'pending', mediaStatus: 'unknown' }),
    'submitted'
  )
})

test('partially_available is not treated as available', () => {
  // A part-imported series is still worth tracking; only a full import is a
  // terminal 'available'.
  assert.equal(
    resolveRequestStatus('approved', { status: 'approved', mediaStatus: 'partially_available' }),
    'approved'
  )
})

test('a completed request is available even while the show is only partly available', () => {
  assert.equal(
    resolveRequestStatus('approved', { status: 'completed', mediaStatus: 'partially_available' }),
    'available'
  )
})

test('a row recorded as failed follows Seerr when Seerr still holds the request', () => {
  // Seerr missing one answer used to be written down as a deleted request; the
  // request carried on in Seerr while the list called it failed.
  assert.equal(
    resolveRequestStatus('failed', { status: 'approved', mediaStatus: 'processing' }),
    'approved'
  )
  assert.equal(
    resolveRequestStatus('failed', { status: 'pending', mediaStatus: 'unknown' }),
    'submitted'
  )
})

test('a restore to the status the row held before failing is a correction, not news', () => {
  // Already announced when it first happened: no second "approved".
  assert.equal(restoreKeepsStatusStamp('approved', 'approved', null, null), true)
  assert.equal(restoreKeepsStatusStamp('submitted', 'submitted', null, null), true)
  // A different status is a decision made since: announced now.
  assert.equal(restoreKeepsStatusStamp('approved', 'submitted', null, null), false)
  assert.equal(restoreKeepsStatusStamp('declined', 'approved', null, null), false)
  // A failed row was never available, so that is news whatever it held.
  assert.equal(restoreKeepsStatusStamp('available', 'approved', null, null), false)
})

test('a row failed before 0225 falls back to the dates, and announces when unsure', () => {
  const failedAt = new Date('2026-10-20T04:30:00Z')
  const before = new Date('2026-10-19T12:00:00Z')
  const after = new Date('2026-10-25T09:00:00Z')
  assert.equal(restoreKeepsStatusStamp('approved', null, failedAt, before), true)
  assert.equal(restoreKeepsStatusStamp('approved', null, failedAt, after), false)
  assert.equal(restoreKeepsStatusStamp('approved', null, null, before), false)
  assert.equal(restoreKeepsStatusStamp('approved', null, failedAt, undefined), false)
})

const live = (status: 'pending' | 'approved' | 'declined' | 'completed', mediaStatus = 'unknown') =>
  ({ status, mediaStatus }) as Parameters<typeof planLiveRecord>[2]

test('the writer never writes over a status someone recorded since it was read', () => {
  // Read as submitted, an admin declined it meanwhile: the older live answer loses.
  assert.deepEqual(
    planLiveRecord('submitted', { status: 'declined', statusChangedAt: null, failedFrom: null }, live('approved')),
    { write: false, status: 'declined' }
  )
  // Gone meanwhile: nothing to write, the caller keeps what it read.
  assert.deepEqual(planLiveRecord('submitted', null, live('approved')), { write: false, status: 'submitted' })
})

test('the writer plans an ordinary move, a restore, or nothing', () => {
  assert.deepEqual(
    planLiveRecord('submitted', { status: 'submitted', statusChangedAt: null, failedFrom: null }, live('approved')),
    { write: true, next: 'approved', restore: false, keepStamp: false }
  )
  assert.deepEqual(
    planLiveRecord('approved', { status: 'approved', statusChangedAt: null, failedFrom: null }, live('approved', 'processing')),
    { write: false, status: 'approved' }
  )
  assert.deepEqual(
    planLiveRecord('failed', { status: 'failed', statusChangedAt: null, failedFrom: 'approved' }, live('approved', 'processing')),
    { write: true, next: 'approved', restore: true, keepStamp: true }
  )
  assert.deepEqual(
    planLiveRecord('failed', { status: 'failed', statusChangedAt: null, failedFrom: 'approved' }, live('approved', 'available')),
    { write: true, next: 'available', restore: true, keepStamp: false }
  )
})

test('the nightly re-check window covers every row, a window per night, wrapping', () => {
  assert.deepEqual(recheckWindow(40, 100, 7), { offset: 0, wrap: 0 })
  const total = 250
  const seen = new Map<number, number>()
  for (let night = 0; night < 3; night++) {
    const { offset, wrap } = recheckWindow(total, 100, night)
    for (let i = offset; i < Math.min(offset + 100, total); i++) seen.set(i, (seen.get(i) ?? 0) + 1)
    for (let i = 0; i < wrap; i++) seen.set(i, (seen.get(i) ?? 0) + 1)
  }
  for (let i = 0; i < total; i++) assert.ok((seen.get(i) ?? 0) >= 1, `row ${i} never checked`)
  // Each night checks a full batch.
  assert.deepEqual(recheckWindow(total, 100, 2), { offset: 200, wrap: 50 })
})
