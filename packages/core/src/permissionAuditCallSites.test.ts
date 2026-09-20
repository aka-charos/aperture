import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringLiterals } from './recommender/watchHistoryCallSites.test.js'
import { AUDITED_USER_PERMISSIONS } from './permissionAudit.js'

/**
 * Every write of a permission column is recorded.
 *
 * WHY A SOURCE SCAN. An audit trail is only worth the writers it covers, and
 * "remember to call the recorder" is exactly the convention that does not
 * survive: the writers are spread over six files in two packages, three of them
 * are `INSERT`s that look nothing like the others, and the failure is silent in
 * the worst way — the table exists, it has rows in it, and the one change
 * somebody is asking about is the one that was never recorded. There is no
 * error, no gap in the ids, nothing to notice.
 *
 * WHY NOT A DATABASE TRIGGER. A trigger would catch every writer by
 * construction, including ones written later, and it was the first choice.
 * It cannot know the ACTOR: Postgres has no request context, and passing one
 * through a session GUC needs every write to run inside an explicit
 * transaction on a pinned connection, which `query()` (pooled, autocommit)
 * does not do. "Who" is most of the value here — "I could do this yesterday"
 * is answered by a name — so the actor won, and this scan covers the drift
 * the trigger would have covered for free.
 *
 * WHAT COUNTS AS RECORDING IT. The file calls `auditUserPermissions`,
 * `recordPermissionChanges`, or reads `readUserPermissions` for the before
 * snapshot. Checked per FILE rather than per statement, because a handler that
 * builds its UPDATE in one place and audits it in another is correct code, and
 * a statement-level scan would push people to inline the audit into the query
 * to satisfy a test.
 *
 * A write that genuinely grants nothing belongs in ALLOWED_UNAUDITED with a
 * reason.
 *
 * Lives in core rather than beside the API routes because it scans BOTH
 * packages, exactly as `watchHistoryCallSites.test.ts` does — and because an
 * api-side test reaching into `packages/core/src` drags core into that
 * package’s rootDir and breaks its typecheck.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')

const SCANNED_ROOTS = [
  join(REPO_ROOT, 'packages', 'core', 'src'),
  join(REPO_ROOT, 'apps', 'api', 'src'),
]

/**
 * The permission columns, spelled here rather than imported from core.
 *
 * Deliberate: this test is the thing that notices when the two lists disagree,
 * so importing the list it is checking against would make it agree with itself.
 * `AUDITED_USER_PERMISSIONS` is pinned against this copy below.
 */
const PERMISSION_COLUMNS = [
  'is_admin',
  'is_enabled',
  'provider_disabled',
  'movies_enabled',
  'series_enabled',
  'discover_enabled',
  'discover_request_enabled',
  'collections_enabled',
  'can_manage_watch_history',
  'email_notifications_allowed',
  'ai_explanation_override_allowed',
]

/** A SQL literal that writes the users table. */
const WRITES_USERS = /\b(?:UPDATE\s+users\b|INSERT\s+INTO\s+users\b)/i

const RECORDS_IT =
  /auditUserPermissions|recordPermissionChanges|readUserPermissions/

function writesAPermission(sql: string): boolean {
  const body = sql.replace(/--[^\n]*/g, '')
  return PERMISSION_COLUMNS.some((column) => new RegExp(`\\b${column}\\b`).test(body))
}

/**
 * Files that write a permission column and legitimately record nothing. Each
 * entry is a claim about every such write in that file.
 */
const ALLOWED_UNAUDITED: Record<string, string> = {
  'packages/core/src/recommender/movies/sync.ts':
    'Imports missing users with every switch off, so it grants nothing. The ' +
    'user sync (users/sync.ts) is the import path that can grant, and it records.',
  'packages/core/src/recommender/series/watchHistorySync.ts': 'Series counterpart of the above.',
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (entry.endsWith('.ts')) yield full
  }
}

function scan(): { offenders: string[]; writes: number; seen: Set<string> } {
  const offenders: string[] = []
  const seen = new Set<string>()
  let writes = 0

  for (const root of SCANNED_ROOTS) {
    for (const file of walk(root)) {
      const rel = relative(REPO_ROOT, file).split(sep).join('/')
      if (rel.endsWith('.test.ts')) continue

      const source = readFileSync(file, 'utf8')
      const records = RECORDS_IT.test(source)

      for (const literal of stringLiterals(source)) {
        if (!WRITES_USERS.test(literal.text)) continue
        if (!writesAPermission(literal.text)) continue
        writes++
        if (records) continue
        if (rel in ALLOWED_UNAUDITED) {
          seen.add(rel)
          continue
        }
        offenders.push(`${rel}:${literal.line}`)
      }
    }
  }

  return { offenders, writes, seen }
}

test('every write of a permission column is recorded', () => {
  const { offenders } = scan()

  assert.deepEqual(
    offenders,
    [],
    'These write a permission column without recording it, so the change cannot ' +
      'be asked about later. Call auditUserPermissions (with readUserPermissions ' +
      'for the before snapshot) — or, if the write grants nothing, add the file ' +
      'to ALLOWED_UNAUDITED with a reason:\n  ' +
      offenders.join('\n  ')
  )
})

test('the scan finds the writers, and every allowlist entry is still needed', () => {
  // A walk that silently found nothing would make the test above pass forever.
  const { writes, seen } = scan()
  assert.ok(writes >= 8, `expected to find the permission writers, saw ${writes}`)

  for (const path of Object.keys(ALLOWED_UNAUDITED)) {
    assert.doesNotThrow(
      () => statSync(join(REPO_ROOT, path)),
      `${path} is allowlisted but no longer exists — drop the entry`
    )
    assert.ok(
      seen.has(path),
      `${path} is allowlisted but has no unrecorded permission write — drop the entry`
    )
  }
})

test('the column list here matches the one the recorder diffs', () => {
  // Two copies on purpose: a scan that imported the list it checks would agree
  // with itself, so the copies are pinned against each other instead. A column
  // added to one and not the other fails here rather than going unwatched.
  assert.deepEqual([...AUDITED_USER_PERMISSIONS], PERMISSION_COLUMNS)
})
