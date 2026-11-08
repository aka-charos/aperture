/**
 * The API during a restore, against a database that never answers.
 *
 * A restore's transaction locks every table it replaces, and a query on one waits
 * rather than fails. A server that accepts a connection and then says nothing is
 * that wait, for every query, so anything that reaches the database here hangs and
 * fails its deadline. No real PostgreSQL is involved: this pins that these answers
 * need no database, which holds whatever the locks turn out to do.
 *
 * The restore is the real `restoreInTransaction`, with a stand-in for psql that
 * runs until told to stop. Run with --test-force-exit, since the one lookup left
 * waiting on the silent database is what the first test is about.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'

/** Long enough for a request that needs nothing but this process. */
const ANSWER_DEADLINE_MS = 2000

const WHOLE_DUMP = [
  '-- PostgreSQL database dump',
  'CREATE TABLE public.aperture_migrations (id integer);',
  'CREATE TABLE public.users (id integer);',
  '-- PostgreSQL database dump complete',
  '',
].join('\n')

const silentSockets: Socket[] = []
let silentDatabase: Server
let dir: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any
let core: typeof import('@aperture/core')
let token: typeof import('./jobProgressToken.js')
let gateCode: string

async function withinDeadline<T>(request: Promise<T>, ms = ANSWER_DEADLINE_MS): Promise<T | 'no answer'> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<'no answer'>((resolve) => {
    timer = setTimeout(() => resolve('no answer'), ms)
  })
  try {
    return await Promise.race([request, deadline])
  } finally {
    clearTimeout(timer)
  }
}

before(async () => {
  silentDatabase = createServer((socket) => {
    silentSockets.push(socket)
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve) => silentDatabase.listen(0, '127.0.0.1', resolve))
  const { port } = silentDatabase.address() as AddressInfo

  process.env.DATABASE_URL = `postgres://restore:test@127.0.0.1:${port}/restore_test`
  process.env.SESSION_SECRET = 'restore-gate-test-secret-of-valid-length'

  dir = mkdtempSync(join(tmpdir(), 'aperture-restore-gate-'))
  mkdirSync(join(dir, 'backups'))

  const { default: Fastify } = await import('fastify')
  const { default: cookie } = await import('@fastify/cookie')
  const { default: authPlugin, requireAuth } = await import('../plugins/auth.js')
  const { registerProgressHandlers } = await import('../routes/jobs/handlers/progress.js')
  const { AJV_OPTIONS } = await import('../config/ajv.js')
  const gate = await import('./restoreGate.js')

  core = await import('@aperture/core')
  token = await import('./jobProgressToken.js')
  gateCode = gate.DATABASE_RESTORING_ERROR.code

  app = Fastify({ ajv: AJV_OPTIONS })
  await app.register(cookie, { secret: process.env.SESSION_SECRET })
  await app.register(authPlugin)
  await registerProgressHandlers(app)
  app.get('/api/a-page-the-browser-left-open', { preHandler: requireAuth }, async () => ({ ok: true }))
  app.get('/not-an-api-route', async () => ({ ok: true }))
  await app.ready()
})

after(async () => {
  for (const socket of silentSockets) socket.destroy()
  silentDatabase.close()
  rmSync(dir, { recursive: true, force: true })
})

interface Answer {
  statusCode: number
  json: () => { code?: string; status?: string }
}

/** The answer, or a failed test if it did not come within the deadline. */
async function answered(request: Promise<Answer>): Promise<Answer> {
  const answer = await withinDeadline(request)
  if (answer === 'no answer') throw new Error(`No answer within ${ANSWER_DEADLINE_MS} ms: this request reached the database`)
  return answer
}

const cookieRequest = (url: string) => app.inject({ method: 'GET', url, cookies: { aperture_session: 'a-session' } })

const progressRequest = (jobId: string, progressToken: string): Promise<Answer> =>
  app.inject({
    method: 'GET',
    url: `/api/jobs/progress/${jobId}`,
    headers: { [token.JOB_PROGRESS_TOKEN_HEADER]: progressToken },
  })

/**
 * Runs a real restore up to the point its psql is running; it ends when `finishFile`
 * appears. The promise is wrapped because an async function returning one bare would
 * wait for it, and it cannot end until the caller has finished looking.
 */
async function restoreHeldOpen(finishFile: string): Promise<{ finished: Promise<void> }> {
  const psql = join(dir, 'held-psql.mjs')
  writeFileSync(
    psql,
    `import { existsSync } from 'node:fs'
     const timer = setInterval(() => { if (existsSync(${JSON.stringify(finishFile)})) { clearInterval(timer); process.exit(0) } }, 20)
    `
  )
  const file = join(dir, 'backups', 'whole.sql')
  writeFileSync(file, WHOLE_DUMP)

  const opened = new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (core.isDatabaseRestoring()) {
        clearInterval(check)
        resolve()
      }
    }, 5)
  })
  const finished = core.restoreInTransaction(
    file,
    { host: 'db', port: '5432', user: 'app', database: 'aperture', password: 'secret' },
    { scratchRoot: join(dir, 'backups'), commands: { pgRestore: ['unused'], psql: [process.execPath, psql] } }
  )
  await opened
  return { finished }
}

test('a session lookup really does wait on this database, so the tests below mean something', async () => {
  assert.equal(core.isDatabaseRestoring(), false)
  const answer = await withinDeadline(cookieRequest('/api/a-page-the-browser-left-open'), 500)
  assert.equal(answer, 'no answer')
})

test('during the transaction nothing waits on the database, and progress stays readable', async () => {
  const jobId = randomUUID()
  const progressToken = token.createJobProgressToken(jobId)
  core.createJobProgress(jobId, 'restore-database', 4)
  const finishFile = join(dir, 'finish')
  const { finished } = await restoreHeldOpen(finishFile)

  try {
    // Pages left open, signed in or not: refused at once, in words the client knows.
    for (const request of [
      cookieRequest('/api/a-page-the-browser-left-open'),
      app.inject({ method: 'GET', url: '/api/a-page-the-browser-left-open' }),
      app.inject({ method: 'GET', url: '/api/a-page-the-browser-left-open', headers: { 'x-api-key': 'a-key' } }),
    ]) {
      const refused = await answered(request)
      assert.equal(refused.statusCode, 503)
      assert.equal(refused.json().code, gateCode)
    }

    // The token reads the job from memory, which is the panel's whole path.
    const withToken = await answered(progressRequest(jobId, progressToken))
    assert.equal(withToken.statusCode, 200)
    assert.equal(withToken.json().status, 'running')

    // Without one nobody can judge the session yet: 503, because a 401 here would
    // tell the page its session had ended, and it would stop watching.
    const noToken = await answered(cookieRequest(`/api/jobs/progress/${jobId}`))
    assert.equal(noToken.statusCode, 503)

    // A token for another job proves nothing about this one.
    const wrongToken = await answered(progressRequest(jobId, token.createJobProgressToken(randomUUID())))
    assert.equal(wrongToken.statusCode, 503)

    // Files and health checks are not API routes, and pass.
    const file = await answered(app.inject({ method: 'GET', url: '/not-an-api-route' }))
    assert.equal(file.statusCode, 200)
  } finally {
    writeFileSync(finishFile, '')
    await finished
  }
  assert.equal(core.isDatabaseRestoring(), false)
})

test('the outcome is still readable with the token once the session may be gone', async () => {
  for (const [end, status] of [
    [(jobId: string) => core.completeJob(jobId, { duration: 1 }), 'completed'],
    [(jobId: string) => core.failJob(jobId, 'psql exited with 3: ERROR: boom'), 'failed'],
  ] as const) {
    const jobId = randomUUID()
    core.createJobProgress(jobId, 'restore-database', 4)
    end(jobId)

    const outcome = await answered(progressRequest(jobId, token.createJobProgressToken(jobId)))
    assert.equal(outcome.statusCode, 200)
    assert.equal(outcome.json().status, status)
  }
})
