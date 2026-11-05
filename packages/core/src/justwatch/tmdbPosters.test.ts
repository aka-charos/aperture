import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { JustWatchStreamingRow } from './types.js'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../lib/db.js')
const { attachTmdbPosterPaths } = await import('./tmdbPosters.js')

const realFetch = globalThis.fetch
let upserts: unknown[][]
let calls: string[]
let restorePool: () => void

const row = (tmdbId: number, objectType = 'MOVIE') =>
  ({ tmdbId, objectType, posterPath: `https://justwatch.test/${tmdbId}.jpg` }) as JustWatchStreamingRow

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => {
  upserts = []
  calls = []
  const pool = getPool()
  const original = pool.query
  Object.assign(pool, {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM system_settings')) return { rows: [{ value: 'key' }], rowCount: 1 }
      if (sql.includes('FROM tmdb_poster_cache')) {
        const asked = (params as unknown[]).flat()
        const cached = [
          ...(asked.includes(1)
            ? [{ tmdb_id: 1, poster_path: '/cached.jpg', fetched_at: new Date() }]
            : []),
          ...(asked.includes(6)
            ? [{ tmdb_id: 6, poster_path: '/old.jpg', fetched_at: new Date(0) }]
            : []),
        ]
        return { rows: cached, rowCount: cached.length }
      }
      if (sql.includes('INSERT INTO tmdb_poster_cache')) {
        upserts.push(params)
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
  })
  restorePool = () => Object.assign(pool, { query: original })
})

afterEach(async () => {
  globalThis.fetch = realFetch
  restorePool()
  await closePool()
})

test('answers without waiting for TMDb, and fills the gap behind the answer', async () => {
  let answer = (_: Response) => {}
  globalThis.fetch = ((url: string | URL) => {
    calls.push(String(url))
    return new Promise<Response>((resolve) => {
      answer = resolve
    })
  }) as typeof fetch

  const rows = await attachTmdbPosterPaths([row(1), row(2)], { language: 'en' })
  assert.equal(rows[0].posterPath, '/cached.jpg')
  assert.equal(rows[1].posterPath, 'https://justwatch.test/2.jpg', "keeps JustWatch's own poster")
  assert.equal(upserts.length, 0)

  await settle()
  assert.equal(calls.length, 1)
  assert.match(calls[0], /\/movie\/2\?/)
  answer(Response.json({ poster_path: '/found.jpg' }))
  await settle()
  assert.equal(upserts.length, 1)
  assert.ok(upserts[0].includes('/found.jpg'))
})

test('a failed lookup keeps nothing; TMDb having no such title is kept', async () => {
  globalThis.fetch = (async () => new Response('down', { status: 500 })) as typeof fetch
  await attachTmdbPosterPaths([row(3)], { language: 'en' })
  await settle()
  assert.equal(upserts.length, 0)

  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch
  await attachTmdbPosterPaths([row(4)], { language: 'en' })
  await settle()
  assert.equal(upserts.length, 1)
  assert.ok(upserts[0].includes(null))
})

test('a saved poster past its time still answers, and is refreshed behind the answer', async () => {
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url))
    return Response.json({ poster_path: '/new.jpg' })
  }) as typeof fetch
  const rows = await attachTmdbPosterPaths([row(6)], { language: 'en' })
  assert.equal(rows[0].posterPath, '/old.jpg')
  await settle()
  assert.match(calls[0], /\/movie\/6\?/)
  assert.ok(upserts[0].includes('/new.jpg'))
})

test('shows are looked up as shows', async () => {
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url))
    return Response.json({ poster_path: '/show.jpg' })
  }) as typeof fetch
  await attachTmdbPosterPaths([row(5, 'SHOW')], { language: 'en' })
  await settle()
  assert.match(calls[0], /\/tv\/5\?/)
})
