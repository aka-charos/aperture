import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isTransientLoadError,
  loadErrorForStatus,
  parseRetryAfter,
  readJsonWithRetry,
  retryDelayFor,
  LOAD_RETRY_DELAYS_MS,
  MAX_RETRY_AFTER_MS,
} from './loadFailure'

test('only a 404 means not found, and a 401 means signed out', () => {
  assert.deepEqual(loadErrorForStatus(404), { kind: 'notFound' })
  assert.deepEqual(loadErrorForStatus(401), { kind: 'signedOut' })
  for (const status of [400, 403, 429, 500, 502, 504]) {
    assert.deepEqual(loadErrorForStatus(status), { kind: 'failed', status })
  }
})

test('brief failures are retried, definite answers are not', () => {
  for (const status of [null, 408, 429, 500, 502, 503, 504]) {
    assert.equal(isTransientLoadError({ kind: 'failed', status }), true, String(status))
  }
  for (const status of [400, 403]) {
    assert.equal(isTransientLoadError({ kind: 'failed', status }), false, String(status))
  }
  assert.equal(isTransientLoadError({ kind: 'notFound' }), false)
  assert.equal(isTransientLoadError({ kind: 'signedOut' }), false)
})

test('Retry-After is read as seconds or a date, and stretches or stops a retry', () => {
  assert.equal(parseRetryAfter(null), null)
  assert.equal(parseRetryAfter('3'), 3000)
  assert.equal(parseRetryAfter('soon'), null)
  const now = Date.parse('2026-10-19T12:00:00Z')
  assert.equal(parseRetryAfter('Mon, 19 Oct 2026 12:00:02 GMT', now), 2000)

  assert.equal(retryDelayFor({ kind: 'failed', status: 503 }, 500), 500)
  assert.equal(retryDelayFor({ kind: 'failed', status: 429, retryAfterMs: 2000 }, 500), 2000)
  assert.equal(retryDelayFor({ kind: 'failed', status: 429, retryAfterMs: 100 }, 500), 500)
  assert.equal(
    retryDelayFor({ kind: 'failed', status: 429, retryAfterMs: MAX_RETRY_AFTER_MS + 1 }, 500),
    null
  )
  assert.equal(retryDelayFor({ kind: 'notFound' }, 500), null)
})

// ---- the retry loop, against a stubbed fetch ----

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

type Answer = Response | Error
function stubFetch(answers: Answer[]): { calls: () => number } {
  let calls = 0
  globalThis.fetch = (async () => {
    const answer = answers[Math.min(calls, answers.length - 1)]
    calls++
    if (answer instanceof Error) throw answer
    return answer
  }) as typeof fetch
  return { calls: () => calls }
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })
const noWait = async () => {}

test('a brief failure is asked again until it answers', async () => {
  const fetched = stubFetch([json({}, 502), new TypeError('network'), json({ title: 'Heat' })])
  const result = await readJsonWithRetry('/api/movies/x', { isLive: () => true, sleep: noWait })
  assert.deepEqual(result, { ok: true, data: { title: 'Heat' } })
  assert.equal(fetched.calls(), 3)
})

test('it gives up after the scheduled retries', async () => {
  const fetched = stubFetch([json({}, 500)])
  const result = await readJsonWithRetry('/api/movies/x', { isLive: () => true, sleep: noWait })
  assert.deepEqual(result, { ok: false, error: { kind: 'failed', status: 500 } })
  assert.equal(fetched.calls(), LOAD_RETRY_DELAYS_MS.length + 1)
})

test('a definite answer is not asked again', async () => {
  for (const [status, kind] of [
    [404, 'notFound'],
    [401, 'signedOut'],
  ] as const) {
    const fetched = stubFetch([json({}, status)])
    const result = await readJsonWithRetry('/api/movies/x', { isLive: () => true, sleep: noWait })
    assert.deepEqual(result, { ok: false, error: { kind } })
    assert.equal(fetched.calls(), 1)
  }
})

test('a 200 that is not JSON is no usable answer, and is retried', async () => {
  const fetched = stubFetch([new Response('<html>tunnel</html>', { status: 200 }), json({ ok: 1 })])
  const result = await readJsonWithRetry('/api/movies/x', { isLive: () => true, sleep: noWait })
  assert.deepEqual(result, { ok: true, data: { ok: 1 } })
  assert.equal(fetched.calls(), 2)
})

test('a Retry-After longer than the page waits stops the retries', async () => {
  const fetched = stubFetch([json({}, 429, { 'Retry-After': '60' })])
  const waits: number[] = []
  const result = await readJsonWithRetry('/api/movies/x', {
    isLive: () => true,
    sleep: async (ms) => void waits.push(ms),
  })
  assert.equal(result?.ok, false)
  assert.equal(fetched.calls(), 1)
  assert.deepEqual(waits, [])
})

test('a caller that moved on during a wait gets nothing and no further request', async () => {
  let live = true
  const fetched = stubFetch([json({}, 503), json({ title: 'late' })])
  const result = await readJsonWithRetry('/api/movies/x', {
    isLive: () => live,
    sleep: async () => {
      live = false
    },
  })
  assert.equal(result, null)
  assert.equal(fetched.calls(), 1)
})
