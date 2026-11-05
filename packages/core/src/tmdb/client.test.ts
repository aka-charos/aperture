import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmdbLookup, tmdbRequest } from './client.js'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const options = { apiKey: 'test-key', maxAttempts: 1 }

test('a lookup tells an answer from absence from failure', async () => {
  globalThis.fetch = async () => Response.json({ id: 1 })
  assert.deepEqual(await tmdbLookup('/tv/1', options), { status: 'ok', data: { id: 1 } })

  globalThis.fetch = async () => new Response(null, { status: 404 })
  assert.deepEqual(await tmdbLookup('/tv/1', options), { status: 'not_found' })

  for (const status of [401, 429, 500, 503]) {
    globalThis.fetch = async () => new Response(null, { status })
    assert.deepEqual(await tmdbLookup('/tv/1', options), { status: 'failed' }, `HTTP ${status}`)
  }

  globalThis.fetch = async () => {
    throw new DOMException('slow', 'TimeoutError')
  }
  assert.deepEqual(await tmdbLookup('/tv/1', options), { status: 'failed' })

  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }
  assert.deepEqual(await tmdbLookup('/tv/1', options), { status: 'failed' })
})

test('tmdbRequest keeps its old contract: the data, else null', async () => {
  globalThis.fetch = async () => Response.json({ id: 1 })
  assert.deepEqual(await tmdbRequest('/tv/1', options), { id: 1 })
  globalThis.fetch = async () => new Response(null, { status: 404 })
  assert.equal(await tmdbRequest('/tv/1', options), null)
  globalThis.fetch = async () => new Response(null, { status: 500 })
  assert.equal(await tmdbRequest('/tv/1', options), null)
})

test('the last attempt does not wait out a 429 it cannot retry', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response(null, { status: 429, headers: { 'Retry-After': '30' } })
  }
  const started = Date.now()
  assert.deepEqual(await tmdbLookup('/tv/1', options), { status: 'failed' })
  assert.equal(calls, 1)
  assert.ok(Date.now() - started < 5000)
})

test('parallel requests start at least one rate slot apart', async () => {
  const starts: number[] = []
  globalThis.fetch = async () => {
    starts.push(Date.now())
    return Response.json({})
  }
  await Promise.all(Array.from({ length: 5 }, () => tmdbLookup('/tv/1', options)))
  assert.equal(starts.length, 5)
  starts.sort((a, b) => a - b)
  // 25ms slots; timers may land a millisecond early, never a whole slot.
  assert.ok(starts[4] - starts[0] >= 4 * 20, `started within ${starts[4] - starts[0]}ms`)
})

test('the timeout and attempts are the caller\'s when given', async (t) => {
  const deadlines: number[] = []
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    deadlines.push(ms)
    return timeout(ms)
  })
  globalThis.fetch = async () => Response.json({})
  await tmdbLookup('/tv/1', { apiKey: 'test-key', timeoutMs: 5000, maxAttempts: 1 })
  await tmdbLookup('/tv/1', { apiKey: 'test-key' })
  assert.deepEqual(deadlines, [5000, 30000])
})
