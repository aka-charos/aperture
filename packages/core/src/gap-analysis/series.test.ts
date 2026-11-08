/**
 * The scan's control flow against a stubbed database, TMDb and Seerr: what gets stored,
 * and when a snapshot is replaced. The rules themselves are in seriesRules.test.ts.
 */

import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../lib/db.js')
const { closeInterruptedSeriesGapRuns, runSeriesGapAnalysis, listSeriesGapShows } = await import('./series.js')
const { hasExistingRequest } = await import('../discover/storage.js')
const { createJobProgress, cancelJob } = await import('../jobs/progress.js')

const realFetch = globalThis.fetch
let restorePool: () => void
let statements: { sql: string; params: unknown[] }[]
let library: { tmdb_id: string; title: string; network: string | null }[]
let held: { tmdb_id: string; season_number: number; held: number; files?: number }[]
let settings: Record<string, string>
let resultRows: unknown[]
let requestRows: unknown[]
let libraryReadFails = false

function respond(sql: string, params: unknown[]): unknown[] {
  if (/system_settings/.test(sql)) return [{ value: settings[params[0] as string] ?? null }]
  if (/DISTINCT ON \(tmdb_id\)/.test(sql)) {
    if (libraryReadFails) throw new Error('library read failed')
    return library
  }
  // One file per number unless a test says otherwise
  if (/COUNT\(DISTINCT covered\.n\)/.test(sql)) return held.map((row) => ({ files: row.held, ...row }))
  if (/COUNT\(DISTINCT tmdb_id\)/.test(sql)) return [{ with_id: library.length, without_id: 2 }]
  if (/INSERT INTO gap_analysis_series_runs/.test(sql)) return [{ id: 'run-1' }]
  if (/SET status = 'completed'/.test(sql)) return [{ id: params[0] }]
  if (/COUNT\(\*\)::int AS c FROM gap_analysis_series_results/.test(sql)) return [{ c: resultRows.length }]
  if (/FROM gap_analysis_series_results r/.test(sql)) return resultRows
  if (/FROM discovery_requests/.test(sql)) return requestRows
  return []
}

const ran = (pattern: RegExp) => statements.filter((s) => pattern.test(s.sql))

function tmdbAnswers(answer: (id: number) => Response | object) {
  globalThis.fetch = (async (url: string | URL) => {
    const address = String(url)
    const tmdb = /\/3\/tv\/(\d+)/.exec(address)
    if (tmdb) {
      const out = answer(Number(tmdb[1]))
      return out instanceof Response ? out : Response.json(out)
    }
    // Seerr: season 3 of show 1 is already on its way.
    return Response.json({ mediaInfo: { id: 1, status: 4, seasons: [{ seasonNumber: 3, status: 3 }] } })
  }) as typeof fetch
}

const threeSeasons = {
  poster_path: '/p.jpg',
  networks: [{ name: 'HBO' }],
  last_episode_to_air: { season_number: 3, episode_number: 10 },
  seasons: [
    { season_number: 0, episode_count: 4, air_date: '2019-01-01' },
    { season_number: 1, episode_count: 10, air_date: '2020-01-01' },
    { season_number: 2, episode_count: 10, air_date: '2021-01-01' },
    { season_number: 3, episode_count: 10, air_date: '2022-01-01' },
  ],
}

beforeEach(() => {
  statements = []
  library = []
  held = []
  resultRows = []
  requestRows = []
  settings = {
    tmdb_api_key: 'key',
    seerr_url: 'http://seerr.test',
    seerr_api_key: 'key',
    seerr_enabled: 'true',
  }
  const pool = getPool()
  const original = pool.query
  Object.assign(pool, {
    query: async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params })
      const rows = respond(sql, params)
      return { rows, rowCount: rows.length }
    },
  })
  restorePool = () => Object.assign(pool, { query: original })
})

afterEach(async () => {
  globalThis.fetch = realFetch
  restorePool()
  await closePool()
})

test('only a show with a gap is stored, with Seerr per season, and a finished scan replaces the old one', async () => {
  library = [
    { tmdb_id: '1', title: 'Gappy', network: 'Some Studio' },
    { tmdb_id: '2', title: 'Whole', network: null },
  ]
  held = [
    { tmdb_id: '1', season_number: 1, held: 10 },
    { tmdb_id: '2', season_number: 1, held: 10 },
    { tmdb_id: '2', season_number: 2, held: 10 },
    { tmdb_id: '2', season_number: 3, held: 10 },
  ]
  tmdbAnswers(() => threeSeasons)

  const result = await runSeriesGapAnalysis()

  assert.equal(result.cancelled, false)
  assert.equal(result.showsScanned, 2)
  assert.equal(result.showsListed, 1)
  assert.equal(result.missingSeasons, 2)

  const inserts = ran(/INSERT INTO gap_analysis_series_results/)
  assert.equal(inserts.length, 1)
  const [, tmdbId, title, poster, networks, numbering, seasons] = inserts[0].params
  assert.equal(tmdbId, 1)
  assert.equal(title, 'Gappy')
  assert.equal(poster, '/p.jpg')
  assert.deepEqual(networks, ['HBO'], "TMDb's networks, not the media server's studio")
  assert.equal(numbering, false)
  const stored = JSON.parse(seasons as string) as { seasonNumber: number; holding: string; seerrStatus: string }[]
  assert.deepEqual(
    stored.map((s) => [s.seasonNumber, s.holding, s.seerrStatus]),
    [
      [1, 'complete', 'none'],
      [2, 'missing', 'none'],
      [3, 'missing', 'processing'],
    ]
  )

  const completedAt = statements.findIndex((s) => /SET status = 'completed'/.test(s.sql))
  const replacedAt = statements.findIndex((s) => /DELETE FROM gap_analysis_series_runs WHERE id <> \$1/.test(s.sql))
  assert.ok(completedAt >= 0 && replacedAt > completedAt, 'the old snapshot goes only after the new one is finished')
})

test('an episode with no file is not held, unless the server reports no paths at all', async () => {
  tmdbAnswers(() => threeSeasons)
  await runSeriesGapAnalysis()
  const sql = ran(/COUNT\(DISTINCT covered\.n\)/)[0].sql
  assert.match(sql, /e\.path IS NOT NULL OR NOT EXISTS \(SELECT 1 FROM episodes WHERE path IS NOT NULL\)/)
})

test('a file holding two episodes counts as both', async () => {
  tmdbAnswers(() => threeSeasons)
  await runSeriesGapAnalysis()
  const sql = ran(/COUNT\(DISTINCT covered\.n\)/)[0].sql
  assert.match(sql, /generate_series\(\s*e\.episode_number,\s*GREATEST\(e\.episode_number, COALESCE\(e\.episode_number_end, e\.episode_number\)\)/)
  assert.match(sql, /COUNT\(DISTINCT e\.episode_number\)::int AS files/)
})

test('a two-part file TMDb counts as one episode leaves the missing seasons listed', async () => {
  library = [{ tmdb_id: '1', title: 'Two Parter', network: null }]
  // Ten files in season 1, one tagged E01-E02: eleven numbers against TMDb's ten
  held = [{ tmdb_id: '1', season_number: 1, held: 11, files: 10 }]
  tmdbAnswers(() => threeSeasons)

  const result = await runSeriesGapAnalysis()

  assert.equal(result.missingSeasons, 2)
  assert.equal(ran(/INSERT INTO gap_analysis_series_results/)[0].params[5], false, 'numbering not doubted')
})

test('closing interrupted scans never stops a boot', async () => {
  const pool = getPool()
  Object.assign(pool, {
    query: async () => {
      throw new Error('relation "gap_analysis_series_runs" does not exist')
    },
  })
  await closeInterruptedSeriesGapRuns()
})

test('the existing-request check ignores a request that named seasons', async () => {
  await hasExistingRequest('user-1', 1, 'series')
  assert.match(ran(/FROM discovery_requests/)[0].sql, /seasons IS NULL/)
})

test('a failed lookup and a show TMDb lacks are counted, never read as complete or as a gap', async () => {
  library = [
    { tmdb_id: '1', title: 'Down', network: null },
    { tmdb_id: '2', title: 'Unknown', network: null },
  ]
  tmdbAnswers((id) => new Response('', { status: id === 1 ? 500 : 404 }))

  const result = await runSeriesGapAnalysis()

  assert.equal(result.showsListed, 0)
  assert.equal(ran(/INSERT INTO gap_analysis_series_results/).length, 0)
  const counts = ran(/UPDATE gap_analysis_series_runs SET\s+shows_scanned/).at(-1)
  assert.equal(counts?.params[4], 1, 'not on TMDb')
  assert.equal(counts?.params[5], 1, 'lookups failed')
})

test('Seerr is not asked about a show whose numbering is doubted', async () => {
  library = [{ tmdb_id: '1', title: 'By Year', network: null }]
  held = [{ tmdb_id: '1', season_number: 2019, held: 10 }]
  const asked: string[] = []
  tmdbAnswers(() => threeSeasons)
  const answering = globalThis.fetch
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    asked.push(String(url))
    return answering(url, init)
  }) as typeof fetch

  const result = await runSeriesGapAnalysis()

  assert.equal(asked.some((u) => u.includes('seerr.test')), false)
  assert.equal(result.missingSeasons, 0)
  assert.equal(ran(/INSERT INTO gap_analysis_series_results/)[0].params[5], true)
})

test('TMDb going silent stops the scan as failed and leaves the last good snapshot', async () => {
  library = Array.from({ length: 80 }, (_, i) => ({ tmdb_id: String(i + 1), title: `S${i}`, network: null }))
  tmdbAnswers(() => new Response('', { status: 500 }))

  await assert.rejects(runSeriesGapAnalysis(), /TMDb stopped answering/)

  assert.equal(ran(/SET status = 'completed'/).length, 0)
  assert.equal(ran(/WHERE id <> \$1/).length, 0, 'the previous snapshot is untouched')
  assert.equal(ran(/SET status = 'failed'/).length, 1)
})

test('TMDb answering nothing fails a library too small to reach the batch limit', async () => {
  library = Array.from({ length: 40 }, (_, i) => ({ tmdb_id: String(i + 1), title: `S${i}`, network: null }))
  tmdbAnswers(() => new Response('', { status: 500 }))

  await assert.rejects(runSeriesGapAnalysis(), /TMDb stopped answering/)

  assert.equal(ran(/SET status = 'completed'/).length, 0)
  assert.equal(ran(/WHERE id <> \$1/).length, 0, 'the previous snapshot is untouched')
  assert.equal(ran(/SET status = 'failed'/).length, 1)
})

test('too many unread shows fail the scan, since they would drop off the list', async () => {
  library = Array.from({ length: 60 }, (_, i) => ({ tmdb_id: String(i + 1), title: `S${i}`, network: null }))
  tmdbAnswers((id) => (id <= 30 ? threeSeasons : new Response('', { status: 500 })))

  await assert.rejects(runSeriesGapAnalysis(), /answered too little/)

  assert.equal(ran(/SET status = 'completed'/).length, 0)
  assert.equal(ran(/WHERE id <> \$1/).length, 0, 'the previous snapshot is untouched')
})

test('a few unread shows do not cost the whole scan', async () => {
  library = Array.from({ length: 60 }, (_, i) => ({ tmdb_id: String(i + 1), title: `S${i}`, network: null }))
  held = library.flatMap((s) =>
    [1, 2, 3].map((season_number) => ({ tmdb_id: s.tmdb_id, season_number, held: 10 }))
  )
  tmdbAnswers((id) => (id <= 6 ? new Response('', { status: 500 }) : threeSeasons))

  const result = await runSeriesGapAnalysis()

  assert.equal(result.cancelled, false)
  assert.equal(ran(/SET status = 'completed'/).length, 1)
})

test('a failure before any show is read still leaves a record', async () => {
  libraryReadFails = true
  try {
    await assert.rejects(runSeriesGapAnalysis(), /library read failed/)
  } finally {
    libraryReadFails = false
  }
  const insertAt = statements.findIndex((s) => /INSERT INTO gap_analysis_series_runs/.test(s.sql))
  const readAt = statements.findIndex((s) => /DISTINCT ON \(tmdb_id\)/.test(s.sql))
  assert.ok(insertAt >= 0 && insertAt < readAt, 'the run row comes first')
  assert.equal(ran(/SET status = 'failed'/).length, 1)
})

test('a library with no shows finishes rather than reading as TMDb being silent', async () => {
  tmdbAnswers(() => new Response('', { status: 500 }))
  const result = await runSeriesGapAnalysis()
  assert.equal(result.cancelled, false)
  assert.equal(ran(/SET status = 'completed'/).length, 1)
})

test('a cancelled scan keeps nothing and reports it did not finish', async () => {
  library = [{ tmdb_id: '1', title: 'Gappy', network: null }]
  tmdbAnswers(() => threeSeasons)
  createJobProgress('job-cancel', 'refresh-series-gaps', 3)
  cancelJob('job-cancel')

  const result = await runSeriesGapAnalysis({ jobId: 'job-cancel' })

  assert.equal(result.cancelled, true)
  assert.equal(result.runId, null)
  assert.equal(ran(/SET status = 'completed'/).length, 0)
  assert.equal(ran(/WHERE id <> \$1/).length, 0)
  assert.equal(ran(/DELETE FROM gap_analysis_series_runs WHERE id = \$1/).length, 1)
})

test('a read applies a request made since the scan', async () => {
  resultRows = [
    {
      tmdb_id: 1,
      title: 'Gappy',
      poster_path: null,
      networks: ['HBO'],
      numbering_differs: false,
      library_id: 'lib-1',
      seasons: [
        { seasonNumber: 1, airDate: null, posterPath: null, airedEpisodes: 10, heldEpisodes: 0, holding: 'missing', seerrStatus: 'none' },
        { seasonNumber: 2, airDate: null, posterPath: null, airedEpisodes: 10, heldEpisodes: 0, holding: 'missing', seerrStatus: 'none' },
      ],
    },
  ]
  requestRows = [{ tmdb_id: 1, seasons: [2] }]

  const { shows, total } = await listSeriesGapShows({ runId: 'run-1' })

  assert.equal(total, 1)
  assert.equal(shows[0].libraryId, 'lib-1')
  assert.deepEqual(
    shows[0].seasons.map((s) => [s.seasonNumber, s.standing, s.requestable]),
    [
      [1, 'missing', true],
      [2, 'requested', false],
    ]
  )
})
