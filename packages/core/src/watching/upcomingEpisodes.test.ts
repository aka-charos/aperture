import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../lib/db.js')
const {
  FORECAST_CONCURRENCY,
  FORECAST_TIMEOUT_MS,
  getUpcomingEpisodeForSeries,
  getUpcomingEpisodes,
  getUpcomingEpisodesReport,
} = await import('./upcomingEpisodes.js')

/**
 * The forecast cache is a module-level singleton shared by every test here, which
 * is why each test takes its own TMDb ids from this counter.
 */
let nextTmdbId = 1000
const tmdbId = () => String(nextTmdbId++)

const realFetch = globalThis.fetch
let apiKey: string | null
let localRows: unknown[]
let seriesRows: Array<{ id: string; tmdb_id: string }>
let writes: Array<{ sql: string; params: unknown[] }>
let restorePool: () => void

const nextEpisode = {
  id: 1,
  name: 'Next',
  overview: null,
  air_date: '2099-01-02',
  season_number: 2,
  episode_number: 3,
}
const tmdbShow = (next: unknown = nextEpisode) => ({
  id: 1,
  name: 'Show',
  next_episode_to_air: next,
  last_episode_to_air: null,
  number_of_episodes: 10,
  number_of_seasons: 2,
  seasons: [],
  status: 'Returning Series',
})
const show = () => ({ id: randomUUID(), tmdb_id: tmdbId() })

beforeEach(() => {
  apiKey = 'test-key'
  localRows = []
  seriesRows = []
  writes = []
  const pool = getPool()
  const original = pool.query
  Object.assign(pool, {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM system_settings')) {
        return { rows: apiKey ? [{ value: apiKey }] : [], rowCount: apiKey ? 1 : 0 }
      }
      if (sql.includes('FROM episodes')) return { rows: localRows, rowCount: localRows.length }
      if (sql.includes('UPDATE series')) {
        writes.push({ sql, params })
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('FROM series')) {
        const wanted = params[0] as string[]
        const rows = seriesRows.filter((row) => wanted.includes(row.id))
        return { rows, rowCount: rows.length }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  })
  restorePool = () => Object.assign(pool, { query: original })
})

afterEach(async () => {
  restorePool()
  globalThis.fetch = realFetch
  await closePool()
})

test('a local future episode wins and asks TMDb nothing', async () => {
  const row = show()
  seriesRows = [row]
  localRows = [
    {
      series_id: row.id,
      season_number: 1,
      episode_number: 4,
      title: 'Local',
      overview: null,
      premiere_date: '2099-01-01',
    },
  ]
  globalThis.fetch = async () => {
    throw new Error('must not reach TMDb')
  }
  const result = await getUpcomingEpisodes([row.id])
  assert.equal(result.get(row.id)?.source, 'emby')
  assert.equal(writes.length, 0)
})

test('tmdbFallbackIds still bounds who is looked up', async () => {
  const asked = show()
  const notAsked = show()
  seriesRows = [asked, notAsked]
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json(tmdbShow())
  }
  const result = await getUpcomingEpisodes([asked.id, notAsked.id], {
    tmdbFallbackIds: new Set([asked.id]),
  })
  assert.equal(calls, 1)
  assert.equal(result.has(asked.id), true)
  assert.equal(result.has(notAsked.id), false)
})

test('lookups run in parallel within the limit, and the second load asks nothing', async () => {
  seriesRows = Array.from({ length: 12 }, show)
  const ids = seriesRows.map((row) => row.id)
  let active = 0
  let peak = 0
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    peak = Math.max(peak, ++active)
    await new Promise((resolve) => setTimeout(resolve, 40))
    active--
    return Response.json(tmdbShow())
  }

  const first = await getUpcomingEpisodes(ids)
  assert.equal(calls, 12)
  assert.ok(peak > 1, 'ran one at a time')
  assert.ok(peak <= FORECAST_CONCURRENCY, `peak ${peak}`)
  assert.equal(first.size, 12)
  assert.equal(writes.length, 12)

  const second = await getUpcomingEpisodes(ids)
  assert.equal(calls, 12, 'a warm load must not reach TMDb')
  assert.equal(writes.length, 12, 'a cached answer was already written')
  assert.deepEqual([...second.entries()], [...first.entries()])
})

test('the answer maps to what the sequential code returned', async () => {
  const row = show()
  seriesRows = [row]
  globalThis.fetch = async () => Response.json(tmdbShow())
  const result = await getUpcomingEpisodes([row.id])
  assert.deepEqual(result.get(row.id), {
    seriesId: row.id,
    seasonNumber: 2,
    episodeNumber: 3,
    title: 'Next',
    overview: null,
    airDate: '2099-01-02',
    source: 'tmdb',
  })
})

test('"no upcoming episode" is remembered', async () => {
  const row = show()
  seriesRows = [row]
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json(tmdbShow(null))
  }
  assert.equal((await getUpcomingEpisodes([row.id])).size, 0)
  assert.equal((await getUpcomingEpisodes([row.id])).size, 0)
  assert.equal(calls, 1)
  assert.equal(writes.length, 1)
})

test('a show TMDb does not know is remembered, and stamped so it is not re-asked', async () => {
  const row = show()
  seriesRows = [row]
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response(null, { status: 404 })
  }
  await getUpcomingEpisodes([row.id])
  await getUpcomingEpisodes([row.id])
  assert.equal(calls, 1)
  assert.match(writes[0].sql, /tmdb_totals_synced_at = NOW\(\)/)
})

for (const [name, fail] of [
  ['an error status', async () => new Response(null, { status: 503 })],
  ['a persistent 429', async () => new Response(null, { status: 429 })],
  [
    'a timeout',
    async () => {
      throw new DOMException('slow', 'TimeoutError')
    },
  ],
  [
    'a dropped connection',
    async () => {
      throw new TypeError('fetch failed')
    },
  ],
] as Array<[string, typeof fetch]>) {
  test(`${name} is not remembered as absence, and writes nothing`, async () => {
    const row = show()
    seriesRows = [row]
    let calls = 0
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      calls++
      return fail(...args)
    }) as typeof fetch

    assert.equal((await getUpcomingEpisodes([row.id])).size, 0)
    assert.equal(calls, 1, 'one attempt: a person is waiting')
    assert.equal(writes.length, 0, 'a failure must not stamp the row as synced')

    globalThis.fetch = async () => Response.json(tmdbShow())
    const retried = await getUpcomingEpisodes([row.id])
    assert.equal(retried.size, 1, 'the next load asks again')
    assert.equal(writes.length, 1)
  })
}

test('each lookup carries the short timeout', async (t) => {
  const row = show()
  seriesRows = [row]
  const deadlines: number[] = []
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    deadlines.push(ms)
    return timeout(ms)
  })
  globalThis.fetch = async () => Response.json(tmdbShow())
  await getUpcomingEpisodes([row.id])
  assert.deepEqual(deadlines, [FORECAST_TIMEOUT_MS])
})

test('no API key: nothing asked, nothing written, nothing remembered', async () => {
  const row = show()
  seriesRows = [row]
  apiKey = null
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json(tmdbShow())
  }
  assert.equal((await getUpcomingEpisodes([row.id])).size, 0)
  assert.equal(calls, 0)
  assert.equal(writes.length, 0)

  apiKey = 'test-key'
  assert.equal((await getUpcomingEpisodes([row.id])).size, 1)
})

test('a show in two libraries shares one lookup, and both rows are answered', async () => {
  const id = tmdbId()
  const a = { id: randomUUID(), tmdb_id: id }
  const b = { id: randomUUID(), tmdb_id: id }
  seriesRows = [a, b]
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json(tmdbShow())
  }
  const result = await getUpcomingEpisodes([a.id, b.id])
  assert.equal(calls, 1)
  assert.equal(result.get(a.id)?.seriesId, a.id)
  assert.equal(result.get(b.id)?.seriesId, b.id)
  // One UPDATE by TMDb id reaches both rows.
  assert.equal(writes.length, 1)
  assert.match(writes[0].sql, /WHERE tmdb_id = \$1/)
  assert.equal(writes[0].params[0], id)
})

test('the single-series lookup shares the cache with the list', async () => {
  const row = show()
  seriesRows = [row]
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json(tmdbShow())
  }
  await getUpcomingEpisodes([row.id])
  const single = await getUpcomingEpisodeForSeries(row.id, row.tmdb_id)
  assert.equal(calls, 1)
  assert.equal(single?.source, 'tmdb')
  assert.equal(single?.seriesId, row.id)
})

test('the request stops waiting at its budget; the answer lands in the cache later', async () => {
  const fast = show()
  const slow = show()
  seriesRows = [fast, slow]
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  globalThis.fetch = async (input) => {
    if (String(input).includes(`/tv/${slow.tmdb_id}?`)) await gate
    return Response.json(tmdbShow())
  }

  const result = await getUpcomingEpisodes([fast.id, slow.id], { forecastBudgetMs: 50 })
  assert.equal(result.has(fast.id), true)
  assert.equal(result.has(slow.id), false)

  release()
  // A later load finds what the straggler brought back, without asking again.
  await new Promise((resolve) => setTimeout(resolve, 20))
  globalThis.fetch = async () => {
    throw new Error('must not reach TMDb')
  }
  const later = await getUpcomingEpisodes([slow.id])
  assert.equal(later.has(slow.id), true)
  assert.equal(result.has(slow.id), false, 'a map already returned does not change')
})

test('the report says why each show has no episode, and never merges the reasons', async () => {
  const onServer = show()
  const forecast = show()
  const noneAnnounced = show()
  const unknownToTmdb = show()
  const failing = show()
  const noTmdbId = randomUUID()
  seriesRows = [onServer, forecast, noneAnnounced, unknownToTmdb, failing]
  localRows = [
    {
      series_id: onServer.id,
      season_number: 1,
      episode_number: 4,
      title: 'Local',
      overview: null,
      premiere_date: '2099-01-01',
    },
  ]
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
    const asked = String(url)
    if (asked.includes(`/tv/${forecast.tmdb_id}`)) return Response.json(tmdbShow())
    if (asked.includes(`/tv/${noneAnnounced.tmdb_id}`)) return Response.json(tmdbShow(null))
    if (asked.includes(`/tv/${unknownToTmdb.tmdb_id}`)) return new Response(null, { status: 404 })
    return new Response(null, { status: 503 })
  }) as typeof fetch

  const ids = [onServer.id, forecast.id, noneAnnounced.id, unknownToTmdb.id, failing.id, noTmdbId]
  const report = await getUpcomingEpisodesReport(ids)

  assert.equal(report.episodes.get(onServer.id)?.source, 'emby')
  assert.equal(report.episodes.get(forecast.id)?.source, 'tmdb')
  assert.deepEqual(Object.fromEntries(report.gaps), {
    [noneAnnounced.id]: 'noneAnnounced',
    [unknownToTmdb.id]: 'noTmdbEntry',
    [failing.id]: 'lookupFailed',
    [noTmdbId]: 'noTmdbEntry',
  })
})

test('the report reads an answer that missed the budget as a failure', async () => {
  const slow = show()
  seriesRows = [slow]
  globalThis.fetch = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
    return Response.json(tmdbShow(null))
  }) as typeof fetch
  const report = await getUpcomingEpisodesReport([slow.id], { forecastBudgetMs: 5 })
  assert.equal(report.gaps.get(slow.id), 'lookupFailed')
  // Let the lookup land before the pool mock is restored.
  await new Promise((resolve) => setTimeout(resolve, 100))
})

test('the report separates a missing key from a show the caller left out', async () => {
  const row = show()
  const leftOut = show()
  seriesRows = [row, leftOut]
  apiKey = null
  const report = await getUpcomingEpisodesReport([row.id, leftOut.id], {
    tmdbFallbackIds: new Set([row.id]),
  })
  assert.equal(report.gaps.get(row.id), 'noTmdbKey')
  assert.equal(report.gaps.get(leftOut.id), 'notAsked')
})
