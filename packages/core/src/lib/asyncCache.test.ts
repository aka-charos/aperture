import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncCache, concurrencyLimit } from './asyncCache.js'

const cacheFor = <T,>(options: Partial<ConstructorParameters<typeof AsyncCache<T>>[0]> = {}) =>
  new AsyncCache<T>({ ttlMs: 60_000, maxEntries: 10, ...options })

test('a value is reused within its time and read again after it', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const cache = cacheFor<number>()
  let loads = 0
  const load = async () => ++loads

  assert.equal(await cache.get('k', load), 1)
  assert.equal(await cache.get('k', load), 1)
  t.mock.timers.tick(60_001)
  assert.equal(await cache.get('k', load), 2)
  cache.clear()
})

test('keys never share a value', async () => {
  const cache = cacheFor<string>()
  assert.equal(await cache.get('a', async () => 'A'), 'A')
  assert.equal(await cache.get('b', async () => 'B'), 'B')
  assert.equal(await cache.get('a', async () => 'other'), 'A')
  cache.clear()
})

test('concurrent callers share one load', async () => {
  const cache = cacheFor<number>()
  let loads = 0
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const load = async () => {
    loads++
    await gate
    return loads
  }
  const both = Promise.all([cache.get('k', load), cache.get('k', load)])
  release()
  assert.deepEqual(await both, [1, 1])
  assert.equal(loads, 1)
  cache.clear()
})

test('a failed or null load is not remembered', async () => {
  const cache = cacheFor<string>()
  await assert.rejects(cache.get('k', async () => Promise.reject(new Error('down'))))
  assert.equal(await cache.get('k', async () => null), null)
  assert.equal(cache.size, 0)
  assert.equal(await cache.get('k', async () => 'answer'), 'answer')
  assert.equal(await cache.get('k', async () => 'other'), 'answer')
  cache.clear()
})

test('a falsy value that is an answer is kept', async () => {
  const cache = cacheFor<{ next: null }>()
  let loads = 0
  const load = async () => {
    loads++
    return { next: null }
  }
  await cache.get('k', load)
  await cache.get('k', load)
  assert.equal(loads, 1)
  cache.clear()
})

test('over the entry bound the least recently read goes first', async () => {
  const cache = cacheFor<string>({ maxEntries: 2 })
  await cache.get('a', async () => 'A')
  await cache.get('b', async () => 'B')
  await cache.get('a', async () => 'stale')
  await cache.get('c', async () => 'C')
  assert.equal(await cache.get('a', async () => 'reloaded'), 'A')
  assert.equal(await cache.get('b', async () => 'reloaded'), 'reloaded')
  cache.clear()
})

test('over the weight bound old entries go, and the newest stays however heavy', async () => {
  const cache = cacheFor<number[]>({ maxWeight: 10, weigh: (rows) => rows.length })
  await cache.get('small', async () => [1, 2, 3])
  await cache.get('medium', async () => [1, 2, 3, 4, 5, 6])
  assert.equal(cache.size, 2)
  await cache.get('huge', async () => new Array(50).fill(0))
  assert.equal(cache.size, 1)
  assert.equal((await cache.get('huge', async () => []))?.length, 50)
  cache.clear()
})

test('expired entries are released without another read', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const cache = cacheFor<string>({ ttlMs: 1000 })
  await cache.get('k', async () => 'A')
  assert.equal(cache.size, 1)
  t.mock.timers.tick(1001)
  assert.equal(cache.size, 0)
  cache.clear()
})

test('a load in flight when the cache is cleared is not kept', async () => {
  const cache = cacheFor<string>()
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const inFlight = cache.get('k', async () => {
    await gate
    return 'old'
  })
  cache.clear()
  release()
  assert.equal(await inFlight, 'old')
  assert.equal(cache.size, 0)
})

test('a limit runs no more than its number at once, and every call finishes', async () => {
  const limit = concurrencyLimit(2)
  let active = 0
  let peak = 0
  const results = await Promise.all(
    Array.from({ length: 7 }, (_, i) =>
      limit(async () => {
        peak = Math.max(peak, ++active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active--
        return i
      })
    )
  )
  assert.equal(peak, 2)
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6])
})

test('a failing call frees its slot', async () => {
  const limit = concurrencyLimit(1)
  await assert.rejects(limit(async () => Promise.reject(new Error('no'))))
  assert.equal(await limit(async () => 'next'), 'next')
})
