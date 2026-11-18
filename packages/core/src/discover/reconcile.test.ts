import test from 'node:test'
import assert from 'node:assert/strict'
import { repairKeepsStatusStamp, resolveRequestStatus } from './reconcile.js'

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

test('restoring a wrongly failed row announces only what Seerr decided after the failure', () => {
  const failedAt = new Date('2026-10-20T04:30:00Z')
  const before = new Date('2026-10-19T12:00:00Z')
  const after = new Date('2026-10-25T09:00:00Z')
  // Decided before the row was failed: announced back then, so no second
  // "approved" weeks later.
  assert.equal(repairKeepsStatusStamp('failed', 'approved', failedAt, before), true)
  assert.equal(repairKeepsStatusStamp('failed', 'submitted', failedAt, before), true)
  assert.equal(repairKeepsStatusStamp('failed', 'declined', failedAt, before), true)
  // Decided while the row read as failed: never announced, so announced now.
  assert.equal(repairKeepsStatusStamp('failed', 'approved', failedAt, after), false)
  assert.equal(repairKeepsStatusStamp('failed', 'declined', failedAt, after), false)
  // Either date unknown: announce rather than lose the news.
  assert.equal(repairKeepsStatusStamp('failed', 'approved', null, before), false)
  assert.equal(repairKeepsStatusStamp('failed', 'approved', failedAt, null), false)
  assert.equal(repairKeepsStatusStamp('failed', 'approved', failedAt, undefined), false)
  // A failed row was never available, so that is news.
  assert.equal(repairKeepsStatusStamp('failed', 'available', failedAt, before), false)
  // Ordinary moves always stamp.
  assert.equal(repairKeepsStatusStamp('approved', 'available', failedAt, before), false)
  assert.equal(repairKeepsStatusStamp('submitted', 'approved', failedAt, before), false)
})
