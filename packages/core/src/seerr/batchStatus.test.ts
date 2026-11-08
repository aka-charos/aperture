import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../lib/db.js')
const { batchGetMediaStatus, batchGetSeasonStatuses, deleteRequest, getRequestStatus } = await import('./provider.js')

const realFetch = globalThis.fetch
let settingsReads: number
let calls: string[]
let restorePool: () => void

/** Seerr answering every title as available, `wait` ms later. */
function seerrAnswers(wait = 0) {
  let inFlight = 0
  const state = { peak: 0 }
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url))
    inFlight++
    state.peak = Math.max(state.peak, inFlight)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    inFlight--
    return Response.json({ mediaInfo: { id: 1, status: 5 } })
  }) as typeof fetch
  return state
}

const movies = (ids: number[]) => ids.map((tmdbId) => ({ tmdbId, mediaType: 'movie' as const }))
/** Someone waiting on a page. */
const forViewer = (ids: number[], budgetMs?: number) =>
  batchGetMediaStatus(movies(ids), { interactive: true, budgetMs })

beforeEach(async () => {
  settingsReads = 0
  calls = []
  const pool = getPool()
  const original = pool.query
  const settings: Record<string, string> = {
    seerr_url: 'http://seerr.test',
    seerr_api_key: 'key',
    seerr_enabled: 'true',
  }
  Object.assign(pool, {
    query: async (_sql: string, params: unknown[] = []) => {
      settingsReads++
      return { rows: [{ value: settings[params[0] as string] ?? null }], rowCount: 1 }
    },
  })
  restorePool = () => Object.assign(pool, { query: original })
  // A write forgets every status, so no test sees another's answers.
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch
  await deleteRequest(0)
  settingsReads = 0
})

afterEach(async () => {
  globalThis.fetch = realFetch
  restorePool()
  await closePool()
})

test('settings are read once per batch, however many titles', async () => {
  seerrAnswers()
  const answers = await forViewer([1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(answers.size, 8)
  assert.equal(settingsReads, 3, 'url, key and enabled')
})

test('no more than five calls at once, even across batches', async () => {
  const state = seerrAnswers(5)
  await Promise.all([
    forViewer(Array.from({ length: 12 }, (_, i) => 100 + i)),
    forViewer(Array.from({ length: 12 }, (_, i) => 200 + i)),
  ])
  assert.equal(calls.length, 24)
  assert.equal(state.peak, 5)
})

test('a repeat is answered from the cache, and overlapping batches share a call', async () => {
  seerrAnswers(2)
  await Promise.all([forViewer([300, 301]), forViewer([301, 302])])
  assert.equal(calls.length, 3)

  const again = await forViewer([300, 301, 302])
  assert.equal(calls.length, 3)
  assert.equal(again.size, 3)
})

test('a movie and a show with one TMDb id are different titles', async () => {
  seerrAnswers()
  await batchGetMediaStatus([{ tmdbId: 400, mediaType: 'movie' }], { interactive: true })
  await batchGetMediaStatus([{ tmdbId: 400, mediaType: 'tv' }], { interactive: true })
  assert.deepEqual(calls, ['http://seerr.test/api/v1/movie/400', 'http://seerr.test/api/v1/tv/400'])
})

test('a failure is no answer, and is asked again', async () => {
  globalThis.fetch = (async () => {
    calls.push('refused')
    throw new Error('connection refused')
  }) as typeof fetch
  assert.equal((await forViewer([500])).size, 0)

  seerrAnswers()
  const answers = await forViewer([500])
  assert.equal(answers.get(500)?.exists, true)
  assert.deepEqual(calls, ['refused', 'http://seerr.test/api/v1/movie/500'])
})

test('any write to Seerr forgets what was known', async () => {
  seerrAnswers()
  await forViewer([600])
  assert.equal(calls.length, 1)

  await deleteRequest(1)
  calls = []
  await forViewer([600])
  assert.deepEqual(calls, ['http://seerr.test/api/v1/movie/600'])
})

test('someone waiting stops at the budget; a job gets every answer', async () => {
  seerrAnswers(20)
  const ids = Array.from({ length: 30 }, (_, i) => 700 + i)
  const waiting = await forViewer(ids, 1)
  assert.ok(calls.length <= 5, `${calls.length} calls after the budget ran out`)
  assert.ok(waiting.size < ids.length)

  const job = await batchGetMediaStatus(movies(ids))
  assert.equal(job.size, ids.length)
})

test("a job never takes the answer of someone's spent budget", async () => {
  seerrAnswers(20)
  const ids = Array.from({ length: 20 }, (_, i) => 900 + i)
  const [waiting, job] = await Promise.all([
    forViewer(ids, 1),
    batchGetMediaStatus(movies(ids)),
  ])
  assert.ok(waiting.size < ids.length, 'the viewer ran out of budget')
  assert.equal(job.size, ids.length)
})

test("someone waiting does not queue behind a job's long list", async () => {
  seerrAnswers(20)
  const job = batchGetMediaStatus(movies(Array.from({ length: 50 }, (_, i) => 1000 + i)))
  const waiting = await forViewer([1100, 1101, 1102], 100)
  assert.equal(waiting.size, 3)
  await job
})

test('a job asks Seerr itself, and leaves nothing for a viewer to reuse', async () => {
  seerrAnswers()
  await forViewer([1200])
  await batchGetMediaStatus(movies([1200]))
  assert.equal(calls.length, 2, 'the job did not read the saved answer')

  await batchGetMediaStatus(movies([1201]))
  await forViewer([1201])
  assert.equal(calls.length, 4, 'the viewer did not read a job answer')
})

test('with no Seerr configured nothing is called', async () => {
  const pool = getPool()
  Object.assign(pool, { query: async () => ({ rows: [{ value: null }], rowCount: 1 }) })
  seerrAnswers()
  assert.equal((await batchGetMediaStatus(movies([800]))).size, 0)
  assert.deepEqual(calls, [])
})

test('a job reads each show season by season, and an unanswered show has no entry', async () => {
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url))
    if (String(url).endsWith('/tv/2')) return new Response('nope', { status: 500 })
    if (String(url).endsWith('/tv/3')) return Response.json({})
    return Response.json({ mediaInfo: { id: 1, status: 4, seasons: [{ seasonNumber: 2, status: 5 }] } })
  }) as typeof fetch

  const statuses = await batchGetSeasonStatuses([1, 2, 3])
  assert.equal(statuses.get(1)?.get(2), 'available')
  assert.equal(statuses.has(2), false, 'no answer is not "nothing requested"')
  assert.equal(statuses.get(3)?.size, 0, 'Seerr answered that it knows nothing about this show')
})

test('a finished request reads as completed while the show stays partly available', async () => {
  globalThis.fetch = (async () => Response.json({ id: 9, status: 5, media: { status: 4 } })) as unknown as typeof fetch
  assert.deepEqual(await getRequestStatus(9), { status: 'completed', mediaStatus: 'partially_available' })
})
