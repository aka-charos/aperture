import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONTACT_LOST_AFTER_MS, decidePoll, hasLostContact, lostReason, parseSavedRestore, POLL_TIMEOUT_MS } from './backupPoll'

const json = { isJson: true }

test('a real answer is read', () => {
  assert.equal(decidePoll({ status: 200, ...json }), 'read')
})

test('a refusal ends tracking rather than asking forever, and does not read as finished', () => {
  assert.equal(decidePoll({ status: 401, ...json }), 'authLost')
  assert.equal(decidePoll({ status: 403, ...json }), 'authLost')
})

test('the restore gate and a proxy error page both mean ask again', () => {
  assert.equal(decidePoll({ status: 503, ...json }), 'wait')
  assert.equal(decidePoll({ status: 502, isJson: false }), 'wait')
  assert.equal(decidePoll({ status: 200, isJson: false }), 'wait')
})

test('a job the server no longer holds is gone', () => {
  assert.equal(decidePoll({ status: 404, ...json }), 'gone')
})

test('a long silence is reported, a passing one is not', () => {
  assert.equal(hasLostContact(1000, 1000), false)
  assert.equal(hasLostContact(1000, 1000 + CONTACT_LOST_AFTER_MS - 1), false)
  assert.equal(hasLostContact(1000, 1000 + CONTACT_LOST_AFTER_MS), true)
})

test('one swallowed poll cannot use up the whole wait before the silence is reported', () => {
  assert.ok(POLL_TIMEOUT_MS < CONTACT_LOST_AFTER_MS)
})

test('a job rejoined too late is not reported as lost; one being watched is', () => {
  assert.equal(lostReason('gone', true), 'finishedUnseen')
  assert.equal(lostReason('gone', false), 'gone')
  assert.equal(lostReason('authLost', true), 'authLost')
})

test('a saved restore comes back whole, or not at all', () => {
  const saved = { jobId: 'a', token: 'v1.a.1.sig' }
  assert.deepEqual(parseSavedRestore(JSON.stringify(saved)), saved)
  assert.equal(parseSavedRestore(null), null)
  assert.equal(parseSavedRestore('{not json'), null)
  assert.equal(parseSavedRestore('null'), null)
  assert.equal(parseSavedRestore('{"jobId":"a"}'), null)
})
