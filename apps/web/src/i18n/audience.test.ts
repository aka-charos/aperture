import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, sep } from 'node:path'
import { ADMIN_ONLY_NAMESPACES, ADMIN_SURFACE_PATHS, isAdminSurfacePath } from './audience'

/**
 * The audience split is a measurement, not a list to keep by hand.
 *
 * `audience.ts` says a namespace is admin-only when no viewer-reachable
 * source file reads it. That is checkable, so it is checked: this walks the
 * app source, works out who reads what, and fails when the declaration and
 * the tree disagree — in either direction. Adding a settings section and
 * forgetting to declare its namespace fails here; pasting an admin key into
 * a page every viewer can open fails here too, which is the one this exists
 * for.
 *
 * When it fails because a genuinely admin-only module lives outside the four
 * admin page directories, the fix is a line in `ADMIN_SURFACE_PATHS` — that
 * is the list carrying the judgement calls (the two widgets `Layout.tsx`
 * mounts for everyone and that return null unless `user.isAdmin`).
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..')

/**
 * A key reference is a quote, the namespace, a dot, then the start of a key.
 * The trailing character class is what keeps prose out ("…and the admin. It
 * then…" is not a reference) while still catching the built form
 * `connectionTypes.${type}`, which is how connectionTypeLabel.ts reads its
 * only namespace.
 */
const reference = (namespace: string) => new RegExp(`['"\`]${namespace}\\.[A-Za-z0-9_$]`)

/**
 * These two describe the strings rather than using them, so counting them as
 * readers would let this file decide its own answer.
 */
const NOT_A_READER = ['i18n/audience.ts', 'i18n/audience.test.ts']

function sourceFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (/\.tsx?$/.test(entry.name)) {
        const rel = abs.slice(SRC.length + 1).split(sep).join('/')
        if (!rel.startsWith('i18n/locales/') && !NOT_A_READER.includes(rel)) found.push(rel)
      }
    }
  }
  walk(SRC)
  return found
}

function readersByNamespace(): Map<string, { admin: string[]; user: string[] }> {
  const en = JSON.parse(readFileSync(resolve(SRC, 'i18n/locales/en/translation.json'), 'utf8')) as Record<
    string,
    unknown
  >
  const namespaces = Object.keys(en)
  const readers = new Map(namespaces.map((ns) => [ns, { admin: [] as string[], user: [] as string[] }]))

  for (const rel of sourceFiles()) {
    const source = readFileSync(resolve(SRC, rel), 'utf8')
    const side = isAdminSurfacePath(rel) ? 'admin' : 'user'
    for (const ns of namespaces) {
      if (reference(ns).test(source)) readers.get(ns)![side].push(rel)
    }
  }
  return readers
}

test('every declared admin namespace still exists in the English catalogue', () => {
  const en = JSON.parse(readFileSync(resolve(SRC, 'i18n/locales/en/translation.json'), 'utf8')) as Record<
    string,
    unknown
  >
  const missing = ADMIN_ONLY_NAMESPACES.filter((ns) => !(ns in en))
  assert.deepEqual(
    missing,
    [],
    `ADMIN_ONLY_NAMESPACES names namespaces that are gone from en/translation.json: ${missing.join(', ')}`
  )
})

test('every admin surface path matches at least one file', () => {
  const files = sourceFiles()
  const dead = ADMIN_SURFACE_PATHS.filter((prefix) => !files.some((rel) => rel.startsWith(prefix)))
  assert.deepEqual(
    dead,
    [],
    `ADMIN_SURFACE_PATHS entries match nothing — renamed or deleted: ${dead.join(', ')}`
  )
})

test('the declared audience of every namespace matches who reads it', () => {
  const readers = readersByNamespace()
  const declared = new Set(ADMIN_ONLY_NAMESPACES)
  const problems: string[] = []

  for (const [ns, { admin, user }] of readers) {
    const adminOnly = admin.length > 0 && user.length === 0
    if (adminOnly && !declared.has(ns)) {
      problems.push(
        `'${ns}' is read only from admin surfaces (${admin.slice(0, 3).join(', ')}) — add it to ADMIN_ONLY_NAMESPACES`
      )
    }
    if (!adminOnly && declared.has(ns)) {
      problems.push(
        user.length > 0
          ? `'${ns}' is declared admin-only but is read from a viewer surface: ${user.join(', ')} — either that surface is admin-gated (add it to ADMIN_SURFACE_PATHS) or the namespace is user-facing now`
          : `'${ns}' is declared admin-only but nothing reads it any more — drop it from ADMIN_ONLY_NAMESPACES`
      )
    }
  }

  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`)
})
