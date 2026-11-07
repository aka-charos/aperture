import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequestGuard } from '../../../lib/requestGuard'
import { afterListPage, loadListPage, type ListPage } from './listRequests'

/**
 * The bug this pins: a slow Browse reply to an older search landed after the
 * newer one and replaced it, and an old "load more" appended to a new list.
 * Replies below are released in the order a slow server can produce, through
 * the real loader the three Browse hooks call, with a fetch that honours
 * cancellation the way the browser's does.
 */

interface Pending {
  url: string
  aborted: () => boolean
  reply: (rows: string[], total?: number) => void
  fail: (status: number) => void
}

function fakeServer() {
  const pending: Pending[] = []
  const fetchImpl = ((url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      pending.push({
        url,
        aborted: () => signal?.aborted === true,
        reply: (rows, total = rows.length) =>
          resolve(new Response(JSON.stringify({ rows, total }), { status: 200 })),
        fail: (status) => resolve(new Response('{}', { status })),
      })
    })) as typeof fetch
  return { fetchImpl, pending }
}

const read = (body: unknown): ListPage<string> => {
  const data = body as { rows: string[]; total: number }
  return { items: data.rows, total: data.total }
}

function setup() {
  const guard = createRequestGuard()
  const server = fakeServer()
  const load = (url: string, append = false) =>
    loadListPage({ guard, url, append, read, fetchImpl: server.fetchImpl })
  return { guard, server, load }
}

test('an older search answering after the newer one comes back stale and cancelled', async () => {
  const { guard, server, load } = setup()
  const star = load('/api/movies?search=star&page=1')
  guard.invalidate() // the query changes: useListRequests(listQuery)
  const starWars = load('/api/movies?search=star+wars&page=1')

  server.pending[1].reply(['A New Hope'])
  server.pending[0].reply(['A Star Is Born'])

  assert.deepEqual(await starWars, { kind: 'page', page: { items: ['A New Hope'], total: 1 } })
  assert.deepEqual(await star, { kind: 'stale' })
  assert.equal(server.pending[0].aborted(), true)
})

test('asking for page one cancels a "load more" still in flight', async () => {
  const { server, load } = setup()
  const more = load('/api/movies?page=2', true)
  const fresh = load('/api/movies?page=1')

  server.pending[1].reply(['Collateral'])
  server.pending[0].reply(['Manhunter'])

  assert.deepEqual(await fresh, { kind: 'page', page: { items: ['Collateral'], total: 1 } })
  assert.deepEqual(await more, { kind: 'stale' })
  assert.equal(server.pending[0].aborted(), true)
})

test('"load more" leaves page one current and is applied while its list stands', async () => {
  const { server, load } = setup()
  const first = load('/api/movies?page=1')
  const more = load('/api/movies?page=2', true)
  server.pending[0].reply(['Heat'], 2)
  server.pending[1].reply(['Thief'], 2)

  assert.equal((await first).kind, 'page')
  assert.deepEqual(await more, { kind: 'page', page: { items: ['Thief'], total: 2 } })
})

test('a reply whose generation ends while its body is read is stale, not applied', async () => {
  const guard = createRequestGuard()
  let headersSent = false
  let releaseBody: (body: unknown) => void = () => {}
  // Headers now, body when released, and a body read that ignores the signal,
  // so only the check after the body can catch it.
  const fetchImpl = (async () => {
    headersSent = true
    return {
      ok: true,
      json: () => new Promise((resolve) => (releaseBody = resolve)),
    } as unknown as Response
  }) as typeof fetch
  const request = loadListPage({ guard, url: '/api/movies?page=1', append: false, read, fetchImpl })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(headersSent, true)
  guard.invalidate()
  releaseBody({ rows: ['Heat'], total: 1 })
  assert.deepEqual(await request, { kind: 'stale' })
})

test('only a current request reports an error', async () => {
  const { guard, server, load } = setup()
  const failed = load('/api/movies?page=1')
  server.pending[0].fail(500)
  assert.deepEqual(await failed, { kind: 'failed' })

  const unreadable = loadListPage({
    guard,
    url: '/api/movies?page=1',
    append: false,
    read,
    fetchImpl: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch,
  })
  assert.deepEqual(await unreadable, { kind: 'unreachable' })

  const cancelled = load('/api/movies?page=1')
  guard.invalidate()
  assert.deepEqual(await cancelled, { kind: 'stale' })
})

test('afterListPage counts rows on screen and stops on a short or complete page', () => {
  assert.deepEqual(afterListPage(0, 50, 120, false, 50), { loaded: 50, hasMore: true })
  assert.deepEqual(afterListPage(50, 50, 120, true, 50), { loaded: 100, hasMore: true })
  assert.deepEqual(afterListPage(100, 20, 120, true, 50), { loaded: 120, hasMore: false })
  assert.deepEqual(afterListPage(0, 50, 50, false, 50), { loaded: 50, hasMore: false })
  // Page one replaces, whatever was loaded before.
  assert.deepEqual(afterListPage(300, 50, 120, false, 50), { loaded: 50, hasMore: true })
})

test('every Browse list hook pages through the shared loader and guard', () => {
  for (const name of ['useBrowseMovies', 'useBrowseSeries', 'useBrowsePeople']) {
    const source = readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8')
    assert.match(source, /= useListRequests\(/, `${name}: no list request guard`)
    assert.match(source, /await loadListPage\(\{\s*guard: requests,/, `${name}: pages without the shared loader`)
    assert.match(source, /if \(outcome\.kind === 'stale'\) return\n/, `${name}: a stale reply is not dropped first`)
    // The list itself is never fetched by hand (metadata fetches are fine).
    assert.doesNotMatch(source, /fetch\(`\/api\/(movies|series|discover\/people)\?/, `${name}: fetches its list directly`)
  }
})
