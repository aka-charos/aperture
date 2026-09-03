import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRequestStatus } from './reconcile.js'

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
