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

// An address nothing listens on, so any query fails at once instead of hanging.
process.env.DATABASE_URL ??= 'postgres://boot:test@127.0.0.1:1/boot_test'
// The OpenAPI document is only registered when docs are on, and the API
// reference test below reads it.
process.env.API_DOCS = 'public'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any

before(async () => {
  const { buildServer } = await import('./server.js')
  app = await buildServer({ logger: false })
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
