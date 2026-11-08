/**
 * The movie scan's failure handling against a stubbed database and TMDb: when a snapshot
 * is replaced, and what a failed or interrupted scan leaves behind.
 */

import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../lib/db.js')
const { runLibraryGapAnalysis, closeInterruptedGapRuns } = await import('./index.js')
const { createJobProgress, cancelJob } = await import('../jobs/progress.js')

const REPLACE_OLDER = /DELETE FROM gap_analysis_runs WHERE id <> \$1/
const COMPLETED = /SET status = 'completed', completed_at = NOW\(\)/
const FAILED = /SET status = 'failed'/

const realFetch = globalThis.fetch
let restorePool: () => void
let statements: { sql: string; params: unknown[] }[]
let collectionIds: string[]
let libraryTmdbIds: string[]
let openRunIds: string[]
let breakOn: RegExp | null
let breakRecording: boolean
let runRowGone: boolean
let storedCollections: Record<number, object>
let collectionsAsked: number[]

function respond(sql: string, params: unknown[]): unknown[] {
  if (COMPLETED.test(sql)) return runRowGone ? [] : [{ id: params[0] }]
  if (/FROM tmdb_collection_cache/.test(sql)) {
    return (params[0] as number[])
      .filter((id) => storedCollections[id])
      .map((id) => storedCollections[id])
  }
  if (/system_settings/.test(sql)) return [{ value: params[0] === 'tmdb_api_key' ? 'key' : null }]
  if (/SELECT DISTINCT collection_id/.test(sql)) return collectionIds.map((collection_id) => ({ collection_id }))
  if (/SELECT DISTINCT tmdb_id FROM movies/.test(sql)) return libraryTmdbIds.map((tmdb_id) => ({ tmdb_id }))
  if (/INSERT INTO gap_analysis_runs/.test(sql)) return [{ id: 'run-1' }]
  if (/SELECT id FROM gap_analysis_runs WHERE status = 'running'/.test(sql)) return openRunIds.map((id) => ({ id }))
  return []
}

const ran = (pattern: RegExp) => statements.filter((s) => pattern.test(s.sql))
const indexOf = (pattern: RegExp) => statements.findIndex((s) => pattern.test(s.sql))

function tmdbAnswers(answer: (id: number) => Response | object) {
  globalThis.fetch = (async (url: string | URL) => {
    const collection = /\/3\/collection\/(\d+)/.exec(String(url))
    if (!collection) throw new Error(`Unexpected request: ${String(url)}`)
    const id = Number(collection[1])
    collectionsAsked.push(id)
    const out = answer(id)
    return out instanceof Response ? out : Response.json(out)
  }) as typeof fetch
}

const twoFilms = (id: number) => ({
  id,
  name: `Collection ${id}`,
  overview: null,
  poster_path: null,
  backdrop_path: null,
  parts: [
    { id: id * 10 + 1, title: 'Owned', release_date: '2001-01-01', poster_path: null },
    { id: id * 10 + 2, title: 'Missing', release_date: '2002-01-01', poster_path: null },
  ],
})

beforeEach(() => {
  statements = []
  collectionIds = []
  libraryTmdbIds = []
  openRunIds = []
  breakOn = null
  breakRecording = false
  runRowGone = false
  storedCollections = {}
  collectionsAsked = []
  const pool = getPool()
  const original = pool.query
  Object.assign(pool, {
    query: async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params })
      if (breakOn?.test(sql)) throw new Error('database went away')
      if (breakRecording && FAILED.test(sql)) throw new Error('could not record it either')
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

test('a finished scan replaces the old snapshot, and only once it is complete', async () => {
  collectionIds = ['10']
  libraryTmdbIds = ['101']
  tmdbAnswers(twoFilms)

  const result = await runLibraryGapAnalysis()

  assert.equal(result.runId, 'run-1')
  assert.equal(result.totalParts, 2)
  assert.equal(result.ownedParts, 1)
  assert.equal(result.missingCount, 1)

  assert.equal(ran(/DELETE FROM gap_analysis_runs\s*$/).length, 0, 'nothing wipes the table up front')
  const startedAt = indexOf(/DELETE FROM gap_analysis_runs WHERE status IN \('running', 'failed'\)/)
  const firstResultAt = indexOf(/INSERT INTO gap_analysis_results/)
  const completedAt = indexOf(COMPLETED)
  const replacedAt = indexOf(REPLACE_OLDER)
  assert.ok(startedAt >= 0 && startedAt < firstResultAt, 'only leftovers go at the start')
  assert.ok(completedAt > firstResultAt && replacedAt > completedAt, 'the old snapshot goes after the new one finished')
  assert.deepEqual(statements[replacedAt].params, ['run-1'])
})

test('a scan failing part way leaves the last good snapshot and records why', async () => {
  collectionIds = ['10']
  tmdbAnswers(twoFilms)
  breakOn = /INSERT INTO gap_analysis_results/

  await assert.rejects(runLibraryGapAnalysis(), /database went away/)

  assert.equal(ran(COMPLETED).length, 0)
  assert.equal(ran(REPLACE_OLDER).length, 0, 'the previous snapshot is untouched')
  assert.deepEqual(ran(FAILED)[0].params, ['run-1', 'database went away'])
  assert.deepEqual(ran(/DELETE FROM gap_analysis_results WHERE run_id = \$1/)[0].params, ['run-1'])
})

test('TMDb going silent with nothing stored says so at once, rather than blaming a partial answer', async () => {
  collectionIds = Array.from({ length: 35 }, (_, i) => String(i + 1))
  tmdbAnswers(() => new Response('', { status: 500 }))

  await assert.rejects(runLibraryGapAnalysis(), /TMDb stopped answering/)

  assert.equal(collectionsAsked.length, 10, 'the first batch is already past the allowance')
  assert.equal(ran(COMPLETED).length, 0)
  assert.equal(ran(REPLACE_OLDER).length, 0)
  assert.equal(ran(FAILED).length, 1)
})

test('TMDb going silent stops the scan even when stored lists could stand in for every lookup', async () => {
  collectionIds = Array.from({ length: 35 }, (_, i) => String(i + 1))
  storedCollections = Object.fromEntries(
    collectionIds.map((id) => [
      id,
      { collection_id: Number(id), name: id, overview: null, poster_path: null, backdrop_path: null, parts_json: [] },
    ])
  )
  tmdbAnswers(() => new Response('', { status: 500 }))

  await assert.rejects(runLibraryGapAnalysis(), /TMDb stopped answering/)

  assert.equal(collectionsAsked.length, 30, 'three silent batches of ten, and no more')
  assert.equal(ran(COMPLETED).length, 0)
  assert.equal(ran(REPLACE_OLDER).length, 0)
  assert.equal(ran(FAILED).length, 1)
})

test('a library too small to reach the batch limit still fails when TMDb never answers', async () => {
  collectionIds = ['1', '2']
  tmdbAnswers(() => new Response('', { status: 500 }))

  await assert.rejects(runLibraryGapAnalysis(), /TMDb stopped answering/)

  assert.equal(ran(COMPLETED).length, 0)
  assert.equal(ran(REPLACE_OLDER).length, 0)
})

test('a collection TMDb does not have is an answer: the scan finishes', async () => {
  collectionIds = ['1', '2']
  tmdbAnswers(() => new Response('', { status: 404 }))

  const result = await runLibraryGapAnalysis()

  assert.equal(result.totalParts, 0)
  assert.equal(ran(COMPLETED).length, 1)
  assert.equal(ran(REPLACE_OLDER).length, 1)
})

test('one failed lookup with nothing stored leaves that collection out and uncounted', async () => {
  collectionIds = ['1', '2']
  tmdbAnswers((id) => (id === 1 ? new Response('', { status: 500 }) : twoFilms(id)))

  const result = await runLibraryGapAnalysis()

  assert.equal(result.totalParts, 2)
  assert.equal(result.collectionsScanned, 1, 'only what was read counts as scanned')
  assert.equal(ran(COMPLETED).length, 1)
})

test('a failed lookup uses the stored part list, so the franchise stays in the snapshot', async () => {
  collectionIds = ['1', '2']
  storedCollections = {
    1: {
      collection_id: 1,
      name: 'Stored',
      overview: null,
      poster_path: null,
      backdrop_path: null,
      parts_json: [{ tmdbId: 11, title: 'From before', releaseDate: '2001-01-01', posterPath: null }],
    },
  }
  tmdbAnswers((id) => (id === 1 ? new Response('', { status: 500 }) : twoFilms(id)))

  const result = await runLibraryGapAnalysis()

  assert.equal(result.totalParts, 3)
  assert.equal(result.collectionsScanned, 2)
  const titles = ran(/INSERT INTO gap_analysis_results/).map((s) => s.params[5])
  assert.ok(titles.includes('From before'))
})

test('a scan losing too many collections fails, even though every batch had answers', async () => {
  collectionIds = Array.from({ length: 40 }, (_, i) => String(i + 1))
  tmdbAnswers((id) => (id % 10 === 0 ? twoFilms(id) : new Response('', { status: 500 })))

  await assert.rejects(runLibraryGapAnalysis(), /TMDb answered too little/)

  assert.equal(ran(COMPLETED).length, 0)
  assert.equal(ran(REPLACE_OLDER).length, 0, 'the previous snapshot is untouched')
  assert.equal(ran(FAILED).length, 1)
})

test('a run whose row went away while it scanned replaces nothing', async () => {
  collectionIds = ['10']
  tmdbAnswers(twoFilms)
  runRowGone = true

  await assert.rejects(runLibraryGapAnalysis(), /closed or removed while it was running/)

  assert.equal(ran(REPLACE_OLDER).length, 0, 'deleting "everything else" would take the last snapshot')
})

test('a cancelled scan throws away its own run and keeps the last snapshot', async () => {
  collectionIds = ['10']
  tmdbAnswers(twoFilms)
  createJobProgress('job-cancel-movies', 'refresh-library-gaps', 4)
  cancelJob('job-cancel-movies')

  const result = await runLibraryGapAnalysis({ jobId: 'job-cancel-movies' })

  assert.equal(result.cancelled, true)
  assert.equal(result.runId, null)
  assert.equal(collectionsAsked.length, 0)
  assert.equal(ran(COMPLETED).length, 0)
  assert.equal(ran(REPLACE_OLDER).length, 0)
  assert.deepEqual(ran(/DELETE FROM gap_analysis_runs WHERE id = \$1/)[0].params, ['run-1'])
})

test('a failure before any TMDb call still leaves a failed run saying why', async () => {
  breakOn = /SELECT DISTINCT collection_id/

  await assert.rejects(runLibraryGapAnalysis(), /database went away/)

  assert.deepEqual(ran(FAILED)[0].params, ['run-1', 'database went away'])
})

test('failing to record the failure does not hide the error that caused it', async () => {
  collectionIds = ['10']
  tmdbAnswers(twoFilms)
  breakOn = /INSERT INTO gap_analysis_results/
  breakRecording = true

  await assert.rejects(runLibraryGapAnalysis(), /database went away/)
})

test('a library with no collections finishes empty and still replaces the old snapshot', async () => {
  const result = await runLibraryGapAnalysis()

  assert.equal(result.runId, 'run-1')
  assert.equal(result.collectionsScanned, 0)
  assert.deepEqual(ran(REPLACE_OLDER)[0].params, ['run-1'])
  assert.ok(indexOf(/INSERT INTO gap_analysis_runs/) < indexOf(REPLACE_OLDER))
})

test('closing interrupted runs (boot, after a restore) fails each open row and deletes its partial results', async () => {
  openRunIds = ['dead-1', 'dead-2']

  await closeInterruptedGapRuns()

  assert.deepEqual(
    ran(FAILED).map((s) => s.params),
    [
      ['dead-1', 'The scan was interrupted by a restart.'],
      ['dead-2', 'The scan was interrupted by a restart.'],
    ]
  )
  assert.deepEqual(
    ran(/DELETE FROM gap_analysis_results WHERE run_id = \$1/).map((s) => s.params[0]),
    ['dead-1', 'dead-2']
  )
  assert.equal(ran(REPLACE_OLDER).length, 0, 'the last good snapshot stays')
})

test('with no open run, closing interrupted runs writes nothing', async () => {
  await closeInterruptedGapRuns()

  assert.equal(ran(FAILED).length, 0)
})

test('closing interrupted runs never throws, so a stale row cannot stop a boot', async () => {
  breakOn = /SELECT id FROM gap_analysis_runs/

  await closeInterruptedGapRuns()
})
