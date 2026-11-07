/**
 * The Movies tab's routes against a stubbed database: the job slot, not a `running` row,
 * says whether a scan is alive. Both routes also have an old snapshot beside a live scan
 * to choose between, since a scan no longer clears it up front.
 *
 * Run with --test-force-exit: importing the routes loads the job executor, and a timer
 * started by what it imports keeps the process alive after the tests finish.
 */

import test, { after, afterEach, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { default: Fastify } = await import('fastify')
const { closePool, getPool } = await import('@aperture/core')
const { default: gapAnalysisRoutes } = await import('./index.js')
const { activeJobs } = await import('../jobs/state.js')

const JOB = 'refresh-library-gaps'

type RunRow = {
  id: string
  status: 'running' | 'completed' | 'failed'
  error_message: string | null
  collections_scanned: number
  total_parts: number
  owned_parts: number
  missing_count: number
  started_at: Date
  completed_at: Date | null
  created_at: Date
}

function runRow(id: string, status: RunRow['status'], started: string): RunRow {
  const startedAt = new Date(started)
  return {
    id,
    status,
    error_message: null,
    collections_scanned: 0,
    total_parts: 0,
    owned_parts: 0,
    missing_count: 0,
    started_at: startedAt,
    completed_at: status === 'completed' ? startedAt : null,
    created_at: startedAt,
  }
}

let app: FastifyInstance
let restorePool: () => void
let statements: string[]
let runs: RunRow[]
let summariesReadFor: unknown[]
let partsReadFor: unknown[]

function respond(sql: string, params: unknown[]): unknown[] {
  if (/system_settings/.test(sql)) return [{ value: 'key' }]
  if (/SELECT id FROM gap_analysis_runs WHERE status = 'running'/.test(sql)) {
    return runs.filter((r) => r.status === 'running').map((r) => ({ id: r.id }))
  }
  if (/SET status = 'failed'/.test(sql)) {
    const run = runs.find((r) => r.id === params[0])
    if (run) {
      run.status = 'failed'
      run.error_message = params[1] as string
    }
    return []
  }
  if (/FROM gap_analysis_runs f/.test(sql)) return runs.filter((r) => r.status === 'failed')
  if (/FROM gap_analysis_runs\s+WHERE status = 'running'/.test(sql)) return runs.filter((r) => r.status === 'running')
  if (/FROM gap_analysis_runs\s+WHERE status = 'completed'/.test(sql)) return runs.filter((r) => r.status === 'completed')
  if (/FROM gap_analysis_results r/.test(sql)) {
    partsReadFor.push(params[0])
    return []
  }
  if (/^\s*SELECT[\s\S]*FROM gap_analysis_results\s+WHERE run_id/.test(sql)) {
    summariesReadFor.push(params[0])
    return []
  }
  if (/COUNT\(\*\)::text (as|AS) c FROM movies/.test(sql)) return [{ c: '0' }]
  return []
}

async function latest() {
  const response = await app.inject({ method: 'GET', url: '/api/admin/gap-analysis/latest' })
  assert.equal(response.statusCode, 200)
  return response.json()
}

before(async () => {
  app = Fastify()
  app.decorateRequest('user', undefined)
  app.addHook('onRequest', async (request) => {
    Object.assign(request, { user: { id: 'admin', isAdmin: true } })
  })
  await app.register(gapAnalysisRoutes)
})

after(async () => {
  await app.close()
  await closePool()
})

beforeEach(() => {
  statements = []
  summariesReadFor = []
  partsReadFor = []
  runs = [runRow('good', 'completed', '2026-01-01T00:00:00Z')]
  activeJobs.delete(JOB)
  const pool = getPool()
  const original = pool.query
  Object.assign(pool, {
    query: async (sql: string, params: unknown[] = []) => {
      statements.push(sql)
      const rows = respond(sql, params)
      return { rows, rowCount: rows.length }
    },
  })
  restorePool = () => Object.assign(pool, { query: original })
})

afterEach(() => {
  activeJobs.delete(JOB)
  restorePool()
})

test('a running row with no job behind it does not read as a scan, and the GET writes nothing', async () => {
  runs.push(runRow('dead', 'running', '2026-01-02T00:00:00Z'))

  const body = await latest()

  assert.equal(body.scanning, false)
  assert.equal(body.activeRun, null, 'nothing reads as in progress, so Run analysis is free')
  assert.equal(body.run.id, 'good')
  assert.deepEqual(summariesReadFor, ['good'])
  assert.equal(runs[1].status, 'running')
  assert.deepEqual(
    statements.filter((sql) => /^\s*(UPDATE|DELETE|INSERT)\b/i.test(sql)),
    [],
    'read-only API keys and assumed sessions reach this route'
  )
})

test('an interrupted run is closed at boot, before the scheduler, and after a restore', () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const boot = source('../../index.ts')

  const closedAt = boot.indexOf('await closeInterruptedGapRuns()')
  assert.ok(closedAt >= 0)
  assert.ok(closedAt < boot.indexOf('await initializeScheduler()'), 'no live scan can be closed at boot')
  assert.match(source('../../lib/afterRestore.ts'), /closeGapRunsUnlessScanning\('refresh-library-gaps', closeInterruptedGapRuns\)/)
  assert.equal(source('./index.ts').includes('closeInterruptedGapRuns'), false)
})

test('a running row with the job behind it is left alone and is what the page shows', async () => {
  runs.push(runRow('live', 'running', '2026-01-02T00:00:00Z'))
  activeJobs.set(JOB, 'job-1')

  const body = await latest()

  assert.equal(body.scanning, true)
  assert.equal(body.activeRun.id, 'live')
  assert.equal(body.run.id, 'good')
  assert.equal(body.failedRun, null)
  assert.equal(body.moviesAddedSinceRun, null)
  assert.equal(runs[1].status, 'running')
  assert.equal(statements.some((sql) => /SET status = 'failed'/.test(sql)), false)
  assert.deepEqual(summariesReadFor, ['good'], 'the last good list stays up until the scan finishes')
})

test('a first scan, with nothing to keep showing, is what the page lists', async () => {
  runs = [runRow('live', 'running', '2026-01-02T00:00:00Z')]
  activeJobs.set(JOB, 'job-1')

  const body = await latest()

  assert.equal(body.run, null)
  assert.equal(body.activeRun.id, 'live')
  assert.deepEqual(summariesReadFor, ['live'])
})

test('a scan holding the slot before it has a row reads as scanning, not as no scan', async () => {
  activeJobs.set(JOB, 'job-1')

  const body = await latest()

  assert.equal(body.scanning, true)
  assert.equal(body.activeRun, null)
  assert.equal(body.run.id, 'good')
})

test('a failed run is reported beside the snapshot it did not replace', async () => {
  const message = 'TMDb stopped answering. Check the API key and try again.'
  runs.push({ ...runRow('broke', 'failed', '2026-01-02T00:00:00Z'), error_message: message })

  const body = await latest()

  assert.equal(body.scanning, false)
  assert.equal(body.run.id, 'good')
  assert.equal(body.failedRun.errorMessage, message)
  assert.equal(body.failedRun.failureReason, 'tmdbSilent', 'decided here, so the page can word it')
})

test('collection parts come from the run on display', async () => {
  const parts = () => app.inject({ method: 'GET', url: '/api/admin/gap-analysis/collection-parts?ids=1' })

  assert.equal((await parts()).statusCode, 200)

  runs.push(runRow('live', 'running', '2026-01-02T00:00:00Z'))
  activeJobs.set(JOB, 'job-1')
  assert.equal((await parts()).statusCode, 200, 'a scan does not take the kept snapshot off the page')

  runs = [runRow('live', 'running', '2026-01-02T00:00:00Z')]
  assert.equal((await parts()).statusCode, 200, 'a first scan is listed as it goes')

  assert.deepEqual(partsReadFor, ['good', 'good', 'live'])
})
