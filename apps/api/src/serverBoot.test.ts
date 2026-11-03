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
