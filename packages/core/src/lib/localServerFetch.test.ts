import test from 'node:test'
import assert from 'node:assert/strict'
import { describeLocalFetchFailure, localServerAuthHeaders } from './localServerFetch.js'

const HINTS = { refused: 'REFUSED-HINT', timedOut: 'TIMEOUT-HINT' }

/** A connection failure as undici throws it: the code is on the cause. */
function fetchFailure(code: string): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: { code } })
}

test('a host that does not resolve points at host.docker.internal', () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN']) {
    const text = describeLocalFetchFailure(fetchFailure(code), HINTS)
    assert.match(text, new RegExp(`Host not found \\(${code}\\)`))
    assert.match(text, /host\.docker\.internal/)
  }
})

test("refused and timed out each carry the server's own hint", () => {
  assert.equal(
    describeLocalFetchFailure(fetchFailure('ECONNREFUSED'), HINTS),
    'Connection refused (ECONNREFUSED). REFUSED-HINT'
  )
  for (const code of ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']) {
    assert.equal(
      describeLocalFetchFailure(fetchFailure(code), HINTS),
      `Timed out reaching the server (${code}). TIMEOUT-HINT`
    )
  }
})

test("the probe's own deadline reads as a timeout, not as an abort", () => {
  // AbortSignal.timeout rejects with a DOMException named TimeoutError and no
  // cause code, which used to surface as "The operation was aborted due to timeout".
  const err = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  // DOMException is not an Error subclass in every runtime; the name is what counts.
  const asError = Object.assign(new Error(err.message), { name: 'TimeoutError' })
  assert.equal(describeLocalFetchFailure(asError, HINTS), 'Timed out reaching the server. TIMEOUT-HINT')
})

test('anything else keeps its own message, with the code when there is one', () => {
  assert.equal(describeLocalFetchFailure(fetchFailure('ECONNRESET'), HINTS), 'Connection reset (ECONNRESET).')
  assert.equal(describeLocalFetchFailure(fetchFailure('EPIPE'), HINTS), 'fetch failed (EPIPE)')
  assert.equal(describeLocalFetchFailure(new Error('boom'), HINTS), 'boom')
  assert.equal(describeLocalFetchFailure('plain', HINTS), 'plain')
})

test('a key is sent only when one was entered', () => {
  assert.deepEqual(localServerAuthHeaders(), { Accept: 'application/json' })
  assert.deepEqual(localServerAuthHeaders(''), { Accept: 'application/json' })
  assert.deepEqual(localServerAuthHeaders('sk-unsloth-x'), {
    Accept: 'application/json',
    Authorization: 'Bearer sk-unsloth-x',
  })
})
