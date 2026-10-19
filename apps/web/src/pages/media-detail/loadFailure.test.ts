import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTransientLoadError, loadErrorForStatus } from './loadFailure'

test('only a 404 means the title is not found', () => {
  assert.deepEqual(loadErrorForStatus(404), { kind: 'notFound' })
  for (const status of [400, 401, 403, 429, 500, 502, 504]) {
    assert.deepEqual(loadErrorForStatus(status), { kind: 'failed', status })
  }
})

test('brief failures are retried, definite answers are not', () => {
  for (const status of [null, 408, 429, 500, 502, 503, 504]) {
    assert.equal(isTransientLoadError({ kind: 'failed', status }), true, String(status))
  }
  for (const status of [400, 401, 403]) {
    assert.equal(isTransientLoadError({ kind: 'failed', status }), false, String(status))
  }
  assert.equal(isTransientLoadError({ kind: 'notFound' }), false)
})
