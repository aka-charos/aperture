import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceFiles, stripComments } from '../testing/sourceTree.js'
import { BINDABLE_SECRETS } from './rules.js'

/**
 * A credential that can be linked to Bitwarden is read through
 * `getSystemSetting`, and written through `setSystemSetting`, and by nothing
 * else.
 *
 * WHY A SOURCE SCAN. The row may hold `bws:<name>` instead of the key, and
 * `getSystemSetting` is the one place that turns it back. A query that selects
 * the row itself (`WHERE key = 'seerr_api_key'`, `WHERE key IN (...)`) compiles,
 * runs and returns a string; the string is then sent to Seerr as the API key,
 * and what comes back is a 401 that reads as Seerr's problem. Nothing in the
 * type system separates the two readers.
 *
 * WHAT IS CHECKED. Every mention of a linkable settings key in core and the
 * API, outside the files that define the mechanism, must be the first argument
 * of `getSystemSetting(` or `setSystemSetting(`. A file that needs the row as
 * stored reads it through `getSystemSettingRaw` in `secrets/bindings.ts`, which
 * takes its keys from `BINDABLE_SECRETS` and so never names one.
 *
 * WHAT IS NOT. Writing a resolved value back (`setX({ apiKey: saved.apiKey })`)
 * would copy a secret into the database, and no scan here can see it: the rule
 * is in CLAUDE.md, and the routes take keys from the request body only.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..', '..')
const SCANNED_ROOTS = [join(REPO_ROOT, 'packages', 'core', 'src'), join(REPO_ROOT, 'apps', 'api', 'src')]

/** Files that name the keys to define the mechanism, not to read a credential. */
const DEFINING_FILES = new Set([
  'packages/core/src/secrets/rules.ts',
  // Which settings are never logged: a list of names, no read.
  'packages/core/src/settings/settingLog.ts',
])

const KEYS = BINDABLE_SECRETS.map((s) => s.settingKey)
const MENTION = new RegExp(`['"\`](${KEYS.join('|')})['"\`]`, 'g')
/** The call a mention must be the first argument of, allowing a line break after the bracket. */
const SANCTIONED_CALL = /\b(?:getSystemSetting|setSystemSetting)\(\s*$/

function violationsIn(source: string): string[] {
  const code = stripComments(source)
  const found: string[] = []
  for (const match of code.matchAll(MENTION)) {
    const before = code.slice(Math.max(0, match.index - 80), match.index)
    if (!SANCTIONED_CALL.test(before)) found.push(match[1])
  }
  return found
}

test('the scan recognises both sanctioned calls and rejects a direct read', () => {
  assert.deepEqual(violationsIn(`const k = await getSystemSetting('tmdb_api_key')`), [])
  assert.deepEqual(violationsIn(`await setSystemSetting(\n      'omdb_api_key',\n      key\n    )`), [])
  assert.deepEqual(violationsIn(`// reads 'seerr_api_key' somewhere`), [])
  assert.deepEqual(violationsIn(`query("SELECT value FROM system_settings WHERE key = 'seerr_api_key'")`), [
    'seerr_api_key',
  ])
  assert.deepEqual(violationsIn(`getSystemSettingRaw('tmdb_api_key')`), ['tmdb_api_key'])
  assert.deepEqual(violationsIn(`const KEYS = ['mdblist_api_key', 'app_name']`), ['mdblist_api_key'])
})

test('no code reads or writes a linkable credential around getSystemSetting', () => {
  const violations: string[] = []
  let scanned = 0
  let sanctioned = 0
  for (const root of SCANNED_ROOTS) {
    for (const file of sourceFiles(root)) {
      if (file.endsWith('.test.ts')) continue
      const rel = relative(REPO_ROOT, file).split(sep).join('/')
      if (DEFINING_FILES.has(rel)) continue
      scanned += 1
      const source = readFileSync(file, 'utf8')
      const mentions = [...stripComments(source).matchAll(MENTION)].length
      const bad = violationsIn(source)
      sanctioned += mentions - bad.length
      for (const key of bad) violations.push(`${rel}: '${key}' is not the argument of getSystemSetting/setSystemSetting`)
    }
  }
  assert.deepEqual(violations, [])
  // Floors, so a scan that silently stopped finding anything does not pass.
  assert.ok(scanned > 500, `scanned only ${scanned} files`)
  assert.ok(sanctioned >= KEYS.length, `found only ${sanctioned} sanctioned reads and writes`)
})

test('every defining file still exists', () => {
  for (const rel of DEFINING_FILES) assert.ok(readFileSync(join(REPO_ROOT, rel), 'utf8').length > 0, rel)
})
