import test from 'node:test'
import assert from 'node:assert/strict'
import { decideRequestStatus, liveForClient, type RequestStatusInput } from './requestStatus.js'

const base: RequestStatusInput = { status: 'submitted', awaitingSeerr: false, live: null, inLibrary: false }

test('an arrived request is downloaded until a library the viewer can open holds it', () => {
  const live = { status: 'approved', mediaStatus: 'available' } as const
  assert.equal(decideRequestStatus({ ...base, status: 'available', live }), 'downloaded')
  assert.equal(decideRequestStatus({ ...base, status: 'available', live, inLibrary: true }), 'inLibrary')
  // Without Seerr's answer, the stored status says the same.
  assert.equal(decideRequestStatus({ ...base, status: 'available' }), 'downloaded')
  assert.equal(decideRequestStatus({ ...base, status: 'available', inLibrary: true }), 'inLibrary')
})

test('the library alone does not make a request arrived', () => {
  // A season request for a show the library already holds is still downloading.
  assert.equal(
    decideRequestStatus({ ...base, status: 'approved', live: { status: 'approved', mediaStatus: 'processing' }, inLibrary: true }),
    'processing'
  )
  assert.equal(
    decideRequestStatus({ ...base, status: 'approved', live: { status: 'approved', mediaStatus: 'partially_available' }, inLibrary: true }),
    'partiallyAvailable'
  )
  assert.equal(
    decideRequestStatus({ ...base, status: 'approved', live: { status: 'approved', mediaStatus: 'pending' } }),
    'approved'
  )
})

test('the chip stays inside the filter group of the stored status', () => {
  // The sweep does not walk an approved request back when Seerr says pending
  // again, so neither does the chip: it is listed under "Approved or downloading".
  assert.equal(
    decideRequestStatus({ ...base, status: 'approved', live: { status: 'pending', mediaStatus: 'unknown' } }),
    'approved'
  )
  assert.equal(
    decideRequestStatus({ ...base, status: 'submitted', live: { status: 'pending', mediaStatus: 'unknown' } }),
    'pendingApproval'
  )
  assert.equal(
    decideRequestStatus({ ...base, status: 'pending', live: { status: 'pending', mediaStatus: 'unknown' } }),
    'pendingApproval'
  )
})

test('stored statuses without a live answer', () => {
  assert.equal(decideRequestStatus({ ...base, status: 'submitted' }), 'submitted')
  assert.equal(decideRequestStatus({ ...base, status: 'pending', awaitingSeerr: true }), 'awaitingSeerr')
  assert.equal(decideRequestStatus({ ...base, status: 'pending' }), 'pending')
  assert.equal(decideRequestStatus({ ...base, status: 'declined' }), 'declined')
  assert.equal(decideRequestStatus({ ...base, status: 'failed' }), 'failed')
  assert.equal(decideRequestStatus({ ...base, status: 'something-new' }), null)
})

test("responses carry Seerr's request and media status, nothing else", () => {
  const live = { status: 'approved', mediaStatus: 'processing', updatedAt: new Date() } as const
  assert.deepEqual(liveForClient(live), { status: 'approved', mediaStatus: 'processing' })
  assert.equal(liveForClient(null), null)
})
