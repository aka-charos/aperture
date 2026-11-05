import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../lib/db.js')
const { fetchGenreStripDiscoverCandidates } = await import('./sources.js')

const realFetch = globalThis.fetch
let apiKey: string | null
let calls: string[]
let restorePool: () => void

const movie = (id: number) => ({
  id,
  title: `Title ${id}`,
  original_title: `Title ${id}`,
  original_language: 'en',
  release_date: '2001-01-01',
  poster_path: `/${id}.jpg`,
  backdrop_path: null,
  overview: 'x',
  genre_ids: [18],
  vote_average: 7,
  vote_count: 100,
  popularity: 1,
})

/** Three pages of twenty, ids 1-60. */
function tmdbAnswers() {
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url))
    const page = Number(new URL(String(url)).searchParams.get('page') ?? 1)
    return Response.json({
      page,
      total_pages: 3,
      total_results: 60,
      results: Array.from({ length: 20 }, (_, i) => movie((page - 1) * 20 + i + 1)),
    })
  }) as typeof fetch
}

beforeEach(() => {
  apiKey = 'key-one'
  calls = []
  const pool = getPool()
  const original = pool.query
  Object.assign(pool, {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM system_settings')) return { rows: [{ value: apiKey }], rowCount: 1 }
      // viewer-a has watched the first title, nobody else has.
      if (sql.includes('watch_history') && params.includes('viewer-a')) {
        return { rows: [{ tmdb_id: '1' }], rowCount: 1 }
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

const strip = (userId: string, genre: number, targetCount = 5) =>
  fetchGenreStripDiscoverCandidates('movie', { genreIds: [genre], targetCount, userId })

test('viewers share TMDb pages, and what each has seen stays their own', async () => {
  tmdbAnswers()
  const a = await strip('viewer-a', 18)
  const b = await strip('viewer-b', 18)
  assert.equal(calls.length, 1, 'one page read between them')
  assert.equal(a?.[0].tmdbId, 2, "viewer-a's watched title is gone")
  assert.equal(b?.[0].tmdbId, 1, 'and stays for viewer-b')
})

test('a row walks pages until it is full, each page read once', async () => {
  tmdbAnswers()
  const row = await strip('viewer-b', 27, 45)
  assert.equal(row?.length, 45)
  assert.equal(calls.length, 3)
  await strip('viewer-b', 27, 45)
  assert.equal(calls.length, 3)
})

test('a different filter is a different page, and so is a different API key', async () => {
  tmdbAnswers()
  await strip('viewer-b', 35)
  await strip('viewer-b', 36)
  assert.equal(calls.length, 2)

  apiKey = 'key-two'
  await strip('viewer-b', 35)
  assert.equal(calls.length, 3)
})

test('a failed row says so, and is not remembered', async () => {
  globalThis.fetch = (async () => new Response('down', { status: 500 })) as typeof fetch
  assert.equal(await strip('viewer-b', 53), null)

  tmdbAnswers()
  assert.equal((await strip('viewer-b', 53))?.length, 5)
})

test('TMDb having nothing is an empty row, not a failed one', async () => {
  globalThis.fetch = (async () =>
    Response.json({ page: 1, total_pages: 0, total_results: 0, results: [] })) as typeof fetch
  assert.deepEqual(await strip('viewer-b', 54), [])
})

test('with no TMDb key nothing is asked', async () => {
  apiKey = null
  tmdbAnswers()
  assert.deepEqual(await strip('viewer-b', 80), [])
  assert.deepEqual(calls, [])
})
