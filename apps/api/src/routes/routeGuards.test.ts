import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every route says who may call it, in its registration.
 *
 * WHY A SOURCE SCAN. A route with no `preHandler` is not wrong in a way
 * anything can see. It compiles, it answers, its tests pass, and the only
 * symptom is that a caller who should have been refused is not — which nobody
 * notices, because nobody tries. There were **31** of them when this was
 * written. Most were correctly public (health checks, the login route, the
 * branding the login page renders before any session exists), and finding that
 * out required reading all 31: `GET /api/settings/media-server` handed the
 * server's name, id and public URL to anyone; `/api/genres` enumerated the
 * library; `/api/media/images/*` proxied ANY media-server image path using the
 * admin API key; both avatar routes answered "does this account exist" to the
 * internet. Eight more checked `request.user` inside the handler instead — the
 * same question in a second spelling, invisible to any audit of the route table
 * and easy to forget in the ninth.
 *
 * SO THE POINT IS NOT THE COUNT, IT IS THE REVIEW. This test does not claim
 * every route is guarded. It claims every UNGUARDED route was looked at once,
 * by someone who wrote down why. A new route gets the same treatment, at the
 * moment it is written, from a test failure that names it.
 *
 * WHAT COUNTS AS SAYING IT. A `preHandler` in the registration's options
 * object: `requireAuth`, `requireAdmin`, `requireCapability(...)`, or an array
 * of them. An inline `request.user` check deliberately does NOT count — it is
 * the shape this exists to discourage, it cannot be read from the route table,
 * and the four routes that fenced themselves that way had each picked their own
 * error body.
 *
 * A genuinely public route belongs in PUBLIC_ROUTES with a reason.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..', '..')
const ROUTES_ROOT = join(REPO_ROOT, 'apps', 'api', 'src', 'routes')

/** `fastify.get(`, `fastify.post<{...}>(` — the start of a route registration. */
const REGISTRATION = /\bfastify\.(get|post|put|patch|delete|head|options)\s*[<(]/g

/**
 * Whole files whose every route is deliberately reachable without a session,
 * keyed by repo-relative path. Each entry is a claim about the FILE.
 */
const PUBLIC_FILES: Record<string, string> = {
  'apps/api/src/routes/health/index.ts':
    'Liveness and readiness probes. A probe that needs a credential is not a probe.',
  'apps/api/src/routes/branding/index.ts':
    'Instance name and logo. The login page renders both before any session exists.',
  'apps/api/src/routes/logo/index.ts': 'The logo itself, for the same reason.',
  'apps/api/src/routes/i18n/handlers/publicOverrides.ts':
    'Operator translation overrides. The login page is translated too.',
  'apps/api/src/routes/setup/handlers/admin.ts':
    'First-run setup. The whole /api/setup/* plugin is fenced by its own ' +
    'onRequest hook: refused once setup completes, and refused from a non-local ' +
    'address before that. There is no admin to authenticate against yet.',
  'apps/api/src/routes/setup/handlers/ai.ts': 'Setup wizard; see above.',
  'apps/api/src/routes/setup/handlers/jobs.ts': 'Setup wizard; see above.',
  'apps/api/src/routes/setup/handlers/libraries.ts': 'Setup wizard; see above.',
  'apps/api/src/routes/setup/handlers/mediaServer.ts': 'Setup wizard; see above.',
  'apps/api/src/routes/setup/handlers/openai.ts': 'Setup wizard; see above.',
  'apps/api/src/routes/setup/handlers/output.ts': 'Setup wizard; see above.',
  'apps/api/src/routes/setup/handlers/status.ts': 'Setup wizard; see above.',
  'apps/api/src/routes/setup/handlers/topPicks.ts': 'Setup wizard; see above.',
  'apps/api/src/routes/setup/handlers/users.ts': 'Setup wizard; see above.',
  'apps/api/src/routes/setup/handlers/validation.ts': 'Setup wizard; see above.',
  'apps/api/src/routes/backup/handlers/setup.ts':
    'Restore-from-backup during setup. Registered under /api/setup/*, so the ' +
    'same plugin hook fences it.',
}

/** Individual routes that are public inside an otherwise guarded file. */
const PUBLIC_ROUTES: Record<string, string> = {
  'GET /api/version': 'Build identity. Printed in the footer, and useful in a bug report.',
  'GET /api/auth/login-options': 'Names the media server so the login form can label itself.',
  'POST /api/auth/login': 'The route that mints a session. Rate-limited per IP, plus a per-account lockout.',
  'POST /api/auth/logout': 'Ending a session you may no longer have. Refusing this would strand a bad cookie.',
  'GET /api/auth/check': 'Answers whether the caller is signed in. That IS the question.',
  'GET /api/settings/locales': 'The language list. The login page has a language picker.',
  'GET /api/trakt/callback':
    "Trakt's OAuth redirect. The browser arrives here from trakt.tv, so it is " +
    'authenticated by the one-time state token it carries, not by a session. ' +
    'Also on requestWrites’ WRITING_GETS list, since it writes tokens.',
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (entry.endsWith('.ts')) yield full
  }
}

interface Registration {
  method: string
  path: string
  line: number
  guarded: boolean
}

/**
 * The registrations in one file.
 *
 * A registration's options object sits between the route path and the handler,
 * so the text from `fastify.get` up to the handler is exactly the part that can
 * carry a `preHandler` — and reading only that far means a `preHandler` written
 * inside a nested route in the handler body cannot answer for its parent.
 *
 * The handler is found by its opening `async (` / `(request` rather than by
 * balancing parentheses: generics, object literals and template strings all sit
 * in between, and a brace counter that got any of them wrong would silently
 * scan the wrong span. If a handler is ever written in a shape this misses, the
 * floor assertions below fail rather than the scan quietly passing.
 */
export function registrations(source: string): Registration[] {
  const found: Registration[] = []

  for (const match of source.matchAll(REGISTRATION)) {
    const start = match.index
    const after = source.slice(start)

    const handlerAt = after.search(/async\s*\(|\(\s*_?request\b|\(\s*_?req\b/)
    const head = handlerAt === -1 ? after.slice(0, 2000) : after.slice(0, handlerAt)

    const path = head.match(/['"`](\/[^'"`]*)['"`]/)?.[1]
    if (!path) continue

    found.push({
      method: match[1].toUpperCase(),
      path,
      line: source.slice(0, start).split('\n').length,
      guarded: /preHandler\s*:/.test(head),
    })
  }

  return found
}

function scan(): { unguarded: string[]; total: number; guarded: number; seen: Set<string> } {
  const unguarded: string[] = []
  const seen = new Set<string>()
  let total = 0
  let guarded = 0

  for (const file of walk(ROUTES_ROOT)) {
    const rel = relative(REPO_ROOT, file).split(sep).join('/')
    if (rel.endsWith('.test.ts')) continue

    for (const route of registrations(readFileSync(file, 'utf8'))) {
      total++
      if (route.guarded) {
        guarded++
        continue
      }
      const key = `${route.method} ${route.path}`
      if (rel in PUBLIC_FILES) {
        seen.add(rel)
        continue
      }
      if (key in PUBLIC_ROUTES) {
        seen.add(key)
        continue
      }
      unguarded.push(`${key}  (${rel}:${route.line})`)
    }
  }

  return { unguarded, total, guarded, seen }
}

test('every route declares who may call it, or is a reviewed public route', () => {
  const { unguarded } = scan()

  assert.deepEqual(
    unguarded,
    [],
    'These routes register no preHandler, so nothing refuses an unauthenticated ' +
      'caller. Add requireAuth / requireAdmin / requireCapability(...) — or, if ' +
      'the route is genuinely public, add it to PUBLIC_ROUTES with a reason:\n  ' +
      unguarded.join('\n  ')
  )
})

test('the scan reaches the whole route tree', () => {
  // A walk that silently found nothing would make the test above pass forever,
  // and so would a handler shape the head-finder does not recognise.
  const { total, guarded } = scan()
  assert.ok(total > 400, `expected to find the route table, saw ${total} registrations`)
  assert.ok(guarded > 350, `expected most routes to be guarded, saw ${guarded}`)
})

test('every allowlisted file and route still exists', () => {
  // An entry left behind after its route was renamed is a hole nobody is
  // watching: the route comes back unguarded under a new name and is reported,
  // but the stale entry makes the list read as reviewed.
  const { seen } = scan()

  for (const path of Object.keys(PUBLIC_FILES)) {
    assert.doesNotThrow(
      () => statSync(join(REPO_ROOT, path)),
      `${path} is allowlisted but no longer exists — drop the entry`
    )
    assert.ok(seen.has(path), `${path} is allowlisted but has no unguarded routes — drop the entry`)
  }

  for (const key of Object.keys(PUBLIC_ROUTES)) {
    assert.ok(seen.has(key), `${key} is allowlisted but was not found unguarded — drop the entry`)
  }
})

test('every allowlist entry carries a reason', () => {
  for (const [key, reason] of Object.entries({ ...PUBLIC_FILES, ...PUBLIC_ROUTES })) {
    assert.ok(reason.trim().length > 20, `${key} needs a real reason, not "${reason}"`)
  }
})

test('the head-finder reads the options object and not the handler body', () => {
  // Verified against an injected violation rather than assumed: a scan that
  // matched `preHandler` anywhere in the file would pass every one of these.
  const guardedSource = `fastify.get('/a', { preHandler: requireAuth }, async (request, reply) => {})`
  const openSource = `fastify.get('/a', { schema: s }, async (request, reply) => {
    fastify.get('/nested', { preHandler: requireAuth }, async () => {})
  })`

  assert.equal(registrations(guardedSource)[0].guarded, true)
  assert.equal(registrations(openSource)[0].guarded, false, 'a nested guard answered for its parent')

  // The generic form, and an array of preHandlers, both read correctly.
  const generic = `fastify.post<{ Body: X }>(
    '/b',
    { preHandler: [requireAuth, requireCapability('discover')], schema: s },
    async (request, reply) => {}
  )`
  assert.deepEqual(registrations(generic)[0], {
    method: 'POST',
    path: '/b',
    line: 1,
    guarded: true,
  })
})
