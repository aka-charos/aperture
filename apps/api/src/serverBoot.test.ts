/**
 * The whole server has to finish registering. A route plugin that throws while
 * it registers (a second parser for a content type server.ts already parses, a
 * decorator added twice) passes typecheck, lint and every unit test, and only
 * fails when the container starts: the API crash-loops and the web app never
 * loads. That shipped once, with the newsletter unsubscribe route adding its own
 * multipart/form-data parser beside @fastify/multipart's.
 *
 * Built through the real buildServer, so the plugins and their order are the
 * server's own. No database is needed: registration only reads settings, and
 * every one of those reads falls back when the database cannot be reached.
 * Run with --test-force-exit, since some modules start background timers on
 * import that nothing here owns.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// An address nothing listens on, so any query fails at once instead of hanging.
process.env.DATABASE_URL ??= 'postgres://boot:test@127.0.0.1:1/boot_test'
// The OpenAPI document is only registered when docs are on, and the API
// reference test below reads it.
process.env.API_DOCS = 'public'
// Gives the log tests below a silenced route.
process.env.QUIET_POLL_LOGS = 'true'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

interface LogFields {
  url?: string
  req?: { url?: string }
  res?: { statusCode?: number }
}

/** The lines the server wrote through its own logger at info level. */
const logged: { msg: string; fields: LogFields }[] = []
const ignore = () => {}
const captureLogger = {
  level: 'info',
  info: (fields: LogFields, msg: string) => void logged.push({ msg, fields }),
  warn: ignore,
  error: ignore,
  debug: ignore,
  trace: ignore,
  fatal: ignore,
  silent: ignore,
  child: () => captureLogger,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any

before(async () => {
  const { buildServer } = await import('./server.js')
  app = await buildServer({ loggerInstance: captureLogger as never })
})

after(async () => {
  await app?.close()
  const { closePool } = await import('./lib/db.js')
  await closePool()
})

test('the server registers every plugin and route without throwing', async () => {
  await app.ready()
  assert.ok(app.hasRoute({ method: 'POST', url: '/api/newsletter/unsubscribe' }))
})

test('the unsubscribe link accepts both one-click encodings', async () => {
  await app.ready()
  // With no database the token lookup itself fails, so the answer is a 500
  // from the handler; what matters is that the body got that far rather than
  // being refused with 415 for want of a parser.
  for (const [type, payload] of [
    ['application/x-www-form-urlencoded', 'List-Unsubscribe=One-Click'],
    [
      'multipart/form-data; boundary=X',
      '--X\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click\r\n--X--\r\n',
    ],
  ]) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/newsletter/unsubscribe?token=unknown',
      headers: { 'content-type': type },
      payload,
    })
    assert.notEqual(res.statusCode, 415, `${type} was refused for want of a parser`)
  }
})

test('docs/api-reference.md lists the routes this server serves', async () => {
  await app.ready()
  const { renderApiReference, API_REFERENCE_PATH } = await import('./lib/apiReference.js')
  const { markdown } = renderApiReference(app.swagger())
  // A checkout with autocrlf hands the file back with CRLF line ends.
  const stored = (await readFile(join(REPO_ROOT, API_REFERENCE_PATH), 'utf8')).replace(/\r\n/g, '\n')
  assert.ok(
    stored === markdown,
    `${API_REFERENCE_PATH} is out of date with the routes. Run: pnpm --filter @aperture/api docs:api`,
  )
})

test('an admin newsletter route refuses a form body', async () => {
  await app.ready()
  // The form parser belongs to the unsubscribe scope alone; an admin route
  // accepting a form body could be submitted by a plain HTML form elsewhere.
  const res = await app.inject({
    method: 'POST',
    url: '/api/newsletters',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'subject=x',
  })
  assert.equal(res.statusCode, 415)
})

test('the health check dials what the server binds', async () => {
  const { listenHost, probeUrl } = await import('./config/healthProbe.js')
  assert.equal(listenHost({}), '0.0.0.0')
  assert.equal(listenHost({ HOST: '  ' }), '0.0.0.0')
  assert.equal(probeUrl({}), 'http://127.0.0.1:3456/health')
  assert.equal(probeUrl({ PORT: '8080' }), 'http://127.0.0.1:8080/health')
  assert.equal(probeUrl({ HOST: '0.0.0.0' }), 'http://127.0.0.1:3456/health')
  assert.equal(probeUrl({ HOST: '127.0.0.1' }), 'http://127.0.0.1:3456/health')
  assert.equal(probeUrl({ HOST: '::' }), 'http://[::1]:3456/health')
  assert.equal(probeUrl({ HOST: '::1' }), 'http://[::1]:3456/health')
  assert.equal(probeUrl({ HOST: 'fd00::5' }), 'http://[fd00::5]:3456/health')
  assert.equal(probeUrl({ HOST: '192.168.1.5' }), 'http://192.168.1.5:3456/health')
})

test('the container probe is a probe route from loopback, not forwarded', async () => {
  const { isContainerProbe } = await import('./config/healthProbe.js')
  for (const url of ['/health', '/ready', '/live', '/live?x=1']) {
    assert.equal(isContainerProbe(url, '127.0.0.1', false), true, url)
  }
  assert.equal(isContainerProbe('/health', '::1', false), true)
  assert.equal(isContainerProbe('/health', '::ffff:127.0.0.1', false), true)
  assert.equal(isContainerProbe('/health', '127.0.0.1', true), false, 'through a proxy')
  assert.equal(isContainerProbe('/health', '192.168.1.20', false), false, 'a browser on the LAN')
  assert.equal(isContainerProbe('/health', undefined, false), false)
  assert.equal(isContainerProbe('/api/branding', '127.0.0.1', false), false)
})

/** The access-log lines written for a url since `logged` was last emptied. */
function linesFor(url: string): { msg: string; fields: LogFields }[] {
  return logged.filter(({ fields }) => (fields.url ?? fields.req?.url) === url)
}

test("the container's own check stays out of the sample and the log, but not entirely", async () => {
  await app.ready()
  const { getObservation, resetObservation } = await import('./config/deploymentPosture.js')
  const { resetContainerProbeLog } = await import('./config/healthProbe.js')
  resetObservation()
  resetContainerProbeLog()
  logged.length = 0

  // The first answer is logged, so a reader can see probes arrive; the rest are not.
  for (let i = 0; i < 3; i++) await app.inject({ url: '/live' })
  assert.deepEqual(
    linesFor('/live').map(({ msg, fields }) => [msg, fields.res?.statusCode]),
    [['request completed', 200]]
  )

  // /health answers 503 here (no database). Every failure is logged, by name.
  logged.length = 0
  for (let i = 0; i < 2; i++) await app.inject({ url: '/health' })
  assert.deepEqual(
    linesFor('/health').map(({ msg, fields }) => [msg, fields.res?.statusCode]),
    [
      ['request completed', 503],
      ['request completed', 503],
    ]
  )

  // The recovery is logged once.
  logged.length = 0
  for (let i = 0; i < 2; i++) await app.inject({ url: '/live' })
  assert.equal(linesFor('/live').length, 1)

  assert.equal(getObservation().requestsSeen, 0)
  assert.equal(getObservation().distinctClientIps, 0)
})

test('anyone else calling a probe route is a visitor', async () => {
  await app.ready()
  const { getObservation, resetObservation } = await import('./config/deploymentPosture.js')
  resetObservation()
  logged.length = 0

  await app.inject({ url: '/live', headers: { 'x-forwarded-for': '203.0.113.9' } })
  assert.equal(getObservation().requestsSeen, 1)
  assert.equal(getObservation().forwardedForSeen, 1, 'forwarded evidence must reach the posture')
  assert.deepEqual(
    linesFor('/live').map(({ msg }) => msg),
    ['incoming request']
  )

  logged.length = 0
  await app.inject({ url: '/live', remoteAddress: '192.168.1.20' })
  assert.equal(getObservation().requestsSeen, 2)
  assert.deepEqual(
    linesFor('/live').map(({ msg }) => msg),
    ['incoming request']
  )
  resetObservation()
})

test('a completed line names the url only when no incoming line did', async () => {
  await app.ready()
  logged.length = 0
  await app.inject({ url: '/api/branding' })
  const branding = logged.filter(({ msg }) => msg === 'request completed')
  assert.equal(branding.length, 1)
  assert.equal(branding[0].fields.url, undefined)
  assert.equal(linesFor('/api/branding').length, 1, 'the incoming line names it')

  // Quiet route (QUIET_POLL_LOGS above): no incoming line, and refused here.
  logged.length = 0
  const refused = await app.inject({ url: '/api/jobs/active' })
  assert.ok(refused.statusCode >= 400)
  assert.deepEqual(
    linesFor('/api/jobs/active').map(({ msg }) => msg),
    ['request completed']
  )
})

/** Runs the health check script itself, as the image does. */
function runHealthCheck(port: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) }
    delete env.HOST
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/healthcheck.ts'], {
      cwd: join(REPO_ROOT, 'apps', 'api'),
      env,
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

/** A server bound where the real one binds by default: IPv4 only. */
async function listenOnDefaultHost(status: number): Promise<Server> {
  const { listenHost } = await import('./config/healthProbe.js')
  const server = createServer((request, response) => {
    response.statusCode = request.url === '/health' ? status : 404
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, listenHost({}), resolve))
  return server
}

test('the health check script reaches a server on the default bind and reports its answer', async () => {
  const healthy = await listenOnDefaultHost(200)
  const failing = await listenOnDefaultHost(503)
  const closed = await listenOnDefaultHost(200)
  const closedPort = (closed.address() as AddressInfo).port
  await new Promise((resolve) => closed.close(resolve))

  try {
    const ok = await runHealthCheck((healthy.address() as AddressInfo).port)
    assert.equal(ok.code, 0, ok.stderr)

    const refused = await runHealthCheck((failing.address() as AddressInfo).port)
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /answered 503/)

    const nobody = await runHealthCheck(closedPort)
    assert.equal(nobody.code, 1)
    assert.notEqual(nobody.stderr, '', 'the runtime health log should say why')
  } finally {
    await new Promise((resolve) => healthy.close(resolve))
    await new Promise((resolve) => failing.close(resolve))
  }
})

test("the image's health check runs that script against a route that exists", async () => {
  const dockerfile = await readFile(join(REPO_ROOT, 'docker', 'Dockerfile'), 'utf8')
  const lines = dockerfile.split('\n').map((line) => line.trimEnd())
  const check = lines[lines.findIndex((line) => line.startsWith('HEALTHCHECK ')) + 1]
  assert.equal(check?.trim(), 'CMD ["node", "/app/apps/api/dist/healthcheck.js"]')
  // The runner stage's WORKDIR is what makes that absolute path right.
  assert.ok(lines.includes('WORKDIR /app'))

  await app.ready()
  assert.ok(app.hasRoute({ method: 'GET', url: '/health' }))
})

/** Ask as a production instance whose APP_BASE_URL names another address. */
async function injectAsProductionInstance(options: Record<string, unknown>) {
  const saved = { NODE_ENV: process.env.NODE_ENV, APP_BASE_URL: process.env.APP_BASE_URL }
  process.env.NODE_ENV = 'production'
  process.env.APP_BASE_URL = 'https://aperture.example.com'
  try {
    return await app.inject(options)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('a request from the address it arrived on gets through the real server', async () => {
  await app.ready()
  const res = await injectAsProductionInstance({
    method: 'POST',
    url: '/api/auth/login',
    headers: { host: '192.168.1.5:3456', origin: 'http://192.168.1.5:3456' },
    payload: {},
  })
  // Reaching the login handler's own check is the point: no CORS refusal first.
  assert.equal(res.statusCode, 400)
  assert.equal(res.headers['access-control-allow-origin'], undefined)
})

test('a foreign origin is refused by the real server, forged forwarded host or not', async () => {
  await app.ready()
  const res = await injectAsProductionInstance({
    method: 'POST',
    url: '/api/auth/login',
    remoteAddress: '203.0.113.7',
    headers: {
      host: '192.168.1.5:3456',
      origin: 'https://evil.example',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
    },
    payload: {},
  })
  assert.equal(res.statusCode, 403)
  assert.equal(res.headers['access-control-allow-origin'], undefined)
  assert.equal(res.headers['access-control-allow-credentials'], undefined)
})

test('every route the server documents is one the CORS decision knows is a route', async () => {
  await app.ready()
  const { isRoutePath } = await import('./config/cors.js')
  // A route outside the list would read as a public file: a foreign page's GET of
  // it would run instead of being refused, and the SPA fallback would answer for
  // anything under it.
  const paths = Object.keys(app.swagger().paths as Record<string, unknown>)
  assert.ok(paths.length > 100)
  assert.deepEqual(paths.filter((path) => !isRoutePath(path)), [])
})

for (const url of ['/api/setup/backup/upload', '/api/setup/backup/restore']) {
  test(`${url} refuses a rebound page, though it sits outside the setup plugin`, async () => {
    await app.ready()
    const res = await injectAsProductionInstance({
      method: 'POST',
      url,
      remoteAddress: '192.168.1.20',
      headers: { host: 'evil.example:3456', origin: 'http://evil.example:3456' },
      payload: {},
    })
    assert.equal(res.statusCode, 403)
    assert.match(res.json().error, /APP_BASE_URL/)
  })

  test(`${url} keeps its handler behind the setup fence with no Origin too`, async () => {
    await app.ready()
    // With no database the fence cannot learn whether setup is done, so it fails
    // closed. Reaching the handler would be a 400 or 415 about the body instead.
    const res = await injectAsProductionInstance({
      method: 'POST',
      url,
      remoteAddress: '203.0.113.7',
      headers: { host: 'aperture.example.com' },
      payload: {},
    })
    assert.equal(res.statusCode, 500)
  })
}

test('first-run setup refuses a page that could be another site rebound onto this server', async () => {
  await app.ready()
  // Same-origin as far as the browser and the CORS decision can tell, and from a
  // local address: only the setup guard stands in the way.
  const res = await injectAsProductionInstance({
    method: 'POST',
    url: '/api/setup/complete',
    remoteAddress: '192.168.1.20',
    headers: { host: 'evil.example:3456', origin: 'http://evil.example:3456' },
    payload: {},
  })
  assert.equal(res.statusCode, 403)
  assert.match(res.json().error, /APP_BASE_URL/)
})
