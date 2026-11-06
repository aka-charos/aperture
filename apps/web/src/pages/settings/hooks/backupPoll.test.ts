import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidePoll } from './backupPoll'

const json = { isJson: true }

test('a real answer is read', () => {
  assert.equal(decidePoll({ status: 200, hasToken: false, ...json }), 'read')
  assert.equal(decidePoll({ status: 200, hasToken: true, ...json }), 'read')
})

test('a refusal while holding a token says nothing about the job', () => {
  assert.equal(decidePoll({ status: 401, hasToken: true, ...json }), 'wait')
  assert.equal(decidePoll({ status: 403, hasToken: true, ...json }), 'wait')
})

test('a refusal with no token ends tracking, and does not read as finished', () => {
  assert.equal(decidePoll({ status: 401, hasToken: false, ...json }), 'authLost')
})

test('the restore gate and a proxy error page both mean ask again', () => {
  assert.equal(decidePoll({ status: 503, hasToken: true, ...json }), 'wait')
  assert.equal(decidePoll({ status: 503, hasToken: false, ...json }), 'wait')
  assert.equal(decidePoll({ status: 502, hasToken: true, isJson: false }), 'wait')
  assert.equal(decidePoll({ status: 200, hasToken: true, isJson: false }), 'wait')
})

test('a job the server no longer holds is gone', () => {
  assert.equal(decidePoll({ status: 404, hasToken: true, ...json }), 'gone')
})
