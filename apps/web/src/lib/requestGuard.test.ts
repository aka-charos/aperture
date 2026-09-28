import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequestGuard, isAbortError } from './requestGuard'

/**
 * The bug this pins: a playlist dialog closed while a name or description was generating applied
 * the late answer anyway, writing the old playlist's fields into the next form opened — where
 * Save would store them on a different playlist.
 */

test('a request stays current until its generation ends', () => {
  const guard = createRequestGuard()
  const ticket = guard.begin()
  assert.equal(ticket.isCurrent(), true)
  assert.equal(ticket.signal.aborted, false)

  guard.invalidate()
  assert.equal(ticket.isCurrent(), false)
  assert.equal(ticket.signal.aborted, true)
})

test('a request started after the reset is not affected by it', () => {
  const guard = createRequestGuard()
  const old = guard.begin()
  guard.invalidate()
  const fresh = guard.begin()

  assert.equal(old.isCurrent(), false)
  assert.equal(fresh.isCurrent(), true)
  assert.equal(fresh.signal.aborted, false)
})

test('every request in one generation ends together', () => {
  const guard = createRequestGuard()
  const name = guard.begin()
  const description = guard.begin()
  guard.invalidate()
  assert.equal(name.isCurrent(), false)
  assert.equal(description.isCurrent(), false)
})

test('an abort is recognised, and nothing else is', () => {
  const controller = new AbortController()
  controller.abort()
  assert.equal(isAbortError(controller.signal.reason), true)
  assert.equal(isAbortError(new Error('Failed to fetch')), false)
  assert.equal(isAbortError(new DOMException('x', 'NetworkError')), false)
  assert.equal(isAbortError(undefined), false)
})
