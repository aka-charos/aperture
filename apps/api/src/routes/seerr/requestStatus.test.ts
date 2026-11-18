import test from 'node:test'
import assert from 'node:assert/strict'
import { decideRequestStatus, type RequestStatusInput } from './requestStatus.js'

const base: RequestStatusInput = { status: 'submitted', awaitingSeerr: false, live: null, inLibrary: false }

test('an arrived request is downloaded until the library holds it', () => {
  const live = { status: 'approved', mediaStatus: 'available' } as const
  assert.equal(decideRequestStatus({ ...base, live }), 'downloaded')
  assert.equal(decideRequestStatus({ ...base, live, inLibrary: true }), 'inLibrary')
  // A completed season request counts as arrived while the show is partly there.
  assert.equal(
    decideRequestStatus({ ...base, live: { status: 'completed', mediaStatus: 'partially_available' }, inLibrary: true }),
    'inLibrary'
  )
  // Without Seerr's answer, the stored status says the same.
  assert.equal(decideRequestStatus({ ...base, status: 'available' }), 'downloaded')
  assert.equal(decideRequestStatus({ ...base, status: 'available', inLibrary: true }), 'inLibrary')
})

test('the library alone does not make a request arrived', () => {
  // A season request for a show the library already holds is still downloading.
  assert.equal(
    decideRequestStatus({ ...base, live: { status: 'approved', mediaStatus: 'processing' }, inLibrary: true }),
    'processing'
  )
  assert.equal(
    decideRequestStatus({ ...base, live: { status: 'approved', mediaStatus: 'partially_available' }, inLibrary: true }),
    'partiallyAvailable'
  )
})

test("Seerr's live answer wins over a stored status that fell behind", () => {
  // A row recorded as failed while Seerr carried on downloading it.
  assert.equal(
    decideRequestStatus({ ...base, status: 'failed', live: { status: 'approved', mediaStatus: 'processing' } }),
    'processing'
  )
  assert.equal(
    decideRequestStatus({ ...base, status: 'submitted', live: { status: 'declined', mediaStatus: 'unknown' } }),
    'declined'
  )
  assert.equal(
    decideRequestStatus({ ...base, live: { status: 'pending', mediaStatus: 'unknown' } }),
    'pendingApproval'
  )
  assert.equal(
    decideRequestStatus({ ...base, live: { status: 'approved', mediaStatus: 'pending' } }),
    'approved'
  )
})

test('stored statuses without a live answer', () => {
  assert.equal(decideRequestStatus({ ...base, status: 'pending', awaitingSeerr: true }), 'awaitingSeerr')
  assert.equal(decideRequestStatus({ ...base, status: 'pending' }), 'pending')
  assert.equal(decideRequestStatus({ ...base, status: 'failed' }), 'failed')
  assert.equal(decideRequestStatus({ ...base, status: 'something-new' }), null)
})
