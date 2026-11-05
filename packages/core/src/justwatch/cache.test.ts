import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../lib/db.js')
const { loadCachedOrFetch, streamingCacheTtlMs } = await import('./cache.js')

let saved: Map<string, { payload: unknown; fetched_at: Date }>
let restorePool: () => void

const longAgo = () => new Date(Date.now() - streamingCacheTtlMs() - 1000)
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

beforeEach(() => {
  saved = new Map()
  const pool = getPool()
  const original = pool.query
  Object.assign(pool, {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT payload')) {
        const row = saved.get(params[0] as string)
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
      }
      saved.set(params[0] as string, { payload: params[1], fetched_at: new Date() })
      return { rows: [], rowCount: 1 }
    },
  })
  restorePool = () => Object.assign(pool, { query: original })
})

afterEach(async () => {
  restorePool()
  await closePool()
})

test('a saved chart past its time answers at once while one refresh runs', async () => {
  saved.set('stale-key', { payload: { chart: 'old' }, fetched_at: longAgo() })
  let fetches = 0
  let finish = (_value: unknown) => {}
  const fetcher = () => {
    fetches++
    return new Promise<unknown>((resolve) => {
      finish = resolve
    })
  }

  const first = await loadCachedOrFetch('stale-key', fetcher)
  const second = await loadCachedOrFetch('stale-key', fetcher)
  assert.deepEqual(first, { raw: { chart: 'old' }, stale: true })
  assert.deepEqual(second, { raw: { chart: 'old' }, stale: true })
  assert.equal(fetches, 1, 'one refresh, however many readers')

  finish({ chart: 'new' })
  await tick()
  assert.deepEqual(await loadCachedOrFetch('stale-key', fetcher), {
    raw: { chart: 'new' },
    stale: false,
  })
  assert.equal(fetches, 1)
})

test('a failed refresh leaves the saved chart, and the next reader tries again', async () => {
  saved.set('flaky-key', { payload: { chart: 'old' }, fetched_at: longAgo() })
  let fetches = 0
  const failing = async () => {
    fetches++
    throw new Error('JustWatch away')
  }

  assert.equal((await loadCachedOrFetch('flaky-key', failing)).stale, true)
  await tick()
  const after = await loadCachedOrFetch('flaky-key', failing)
  assert.deepEqual(after, { raw: { chart: 'old' }, stale: true })
  assert.equal(fetches, 2)
  await tick()
})

test('with nothing saved, callers wait for one shared fetch', async () => {
  let fetches = 0
  const fetcher = async () => {
    fetches++
    await tick()
    return { chart: 'first' }
  }
  const answers = await Promise.all([
    loadCachedOrFetch('cold-key', fetcher),
    loadCachedOrFetch('cold-key', fetcher),
  ])
  assert.equal(fetches, 1)
  assert.deepEqual(answers[0], { raw: { chart: 'first' }, stale: false })
  assert.deepEqual(answers[1], { raw: { chart: 'first' }, stale: false })
})

test('with nothing saved, a failure still reaches the caller', async () => {
  await assert.rejects(
    loadCachedOrFetch('dead-key', async () => {
      throw new Error('JustWatch away')
    }),
    /JUSTWATCH_UNAVAILABLE/
  )
})

test('a fresh chart asks nobody', async () => {
  saved.set('fresh-key', { payload: { chart: 'now' }, fetched_at: new Date() })
  const answer = await loadCachedOrFetch('fresh-key', async () => {
    throw new Error('should not be called')
  })
  assert.deepEqual(answer, { raw: { chart: 'now' }, stale: false })
})
