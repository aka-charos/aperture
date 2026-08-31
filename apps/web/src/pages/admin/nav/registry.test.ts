import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  ADMIN_ENTRIES,
  ADMIN_GROUPS,
  ADMIN_GROUP_IDS,
  adminEntriesInGroup,
  adminEntryForPath,
  adminEntryPath,
  adminEntryRoutePath,
} from './registry'
import { legacyTargets } from './legacyRoutes'

/**
 * What stops the admin console's shape drifting.
 *
 * The registry is the only source for the nav tree, the route table and the
 * search index, which makes an omission structural rather than cosmetic — but
 * only some of the ways it can be wrong show up as a broken page. These are the
 * ones that do not: a section with no home, a key that renders as itself, a
 * legacy link pointing at a route that no longer exists.
 *
 * This file reads `elements.tsx` and the barrel as *text* rather than importing
 * them, because both pull in React and MUI and this suite runs under plain
 * `node --test`. A regex over a hand-written map is normally a bad idea; here
 * the alternative is no check at all, and the failure it catches — the
 * `JOB_CATEGORIES` failure — is one nothing else can see.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(HERE, rel), 'utf8')

/** Top-level keys of `ADMIN_ELEMENTS`, quoted or bare. */
function elementIds(): string[] {
  const source = read('./elements.tsx')
  const body = source.slice(source.indexOf('export const ADMIN_ELEMENTS'))
  const ids: string[] = []
  for (const line of body.split('\n')) {
    const match = /^ {2}'?([a-zA-Z0-9-]+)'?: \{$/.exec(line)
    if (match) ids.push(match[1])
  }
  return ids
}

function barrelExports(): string[] {
  const source = read('../../settings/components/index.ts')
  return [...source.matchAll(/export \{ (\w+) \}/g)].map((m) => m[1])
}

function enTranslations(): Record<string, unknown> {
  return JSON.parse(read('../../../i18n/locales/en/translation.json')) as Record<string, unknown>
}

function hasKey(dict: Record<string, unknown>, dotted: string): boolean {
  let node: unknown = dict
  for (const part of dotted.split('.')) {
    if (typeof node !== 'object' || node === null) return false
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string'
}

test('entry ids are unique', () => {
  const ids = ADMIN_ENTRIES.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'two entries share an id')
})

test('entry paths are unique', () => {
  // A collision is not a type error and renders as whichever route matched
  // first — i.e. as a section that silently shows a different section.
  const paths = ADMIN_ENTRIES.map(adminEntryPath)
  assert.equal(new Set(paths).size, paths.length, 'two entries claim the same path')
})

test('exactly one entry is the index route', () => {
  const indexes = ADMIN_ENTRIES.filter((e) => adminEntryRoutePath(e) === '')
  assert.equal(indexes.length, 1)
  assert.equal(adminEntryPath(indexes[0]), '/admin')
})

test('every entry names a real group, and no group is empty', () => {
  for (const entry of ADMIN_ENTRIES) {
    assert.ok(
      ADMIN_GROUP_IDS.includes(entry.group),
      `${entry.id} names group "${entry.group}", which does not exist`
    )
  }
  for (const group of ADMIN_GROUPS) {
    assert.ok(
      adminEntriesInGroup(group.id).length > 0,
      `group "${group.id}" has no entries, so its heading expands to nothing`
    )
  }
})

test('every entry has an element and every element has an entry', () => {
  // The JOB_CATEGORIES failure: a destination that is registered in one list
  // and missing from the other looks fine until someone opens it.
  const entryIds = new Set(ADMIN_ENTRIES.map((e) => e.id))
  const elements = new Set(elementIds())

  for (const id of entryIds) {
    assert.ok(elements.has(id), `entry "${id}" has no element in elements.tsx`)
  }
  for (const id of elements) {
    assert.ok(entryIds.has(id), `element "${id}" has no entry in registry.ts`)
  }
})

test('every registry i18n key resolves in en', () => {
  const en = enTranslations()

  for (const group of ADMIN_GROUPS) {
    assert.ok(hasKey(en, group.labelKey), `missing en string: ${group.labelKey}`)
  }
  for (const entry of ADMIN_ENTRIES) {
    assert.ok(hasKey(en, entry.titleKey), `missing en string: ${entry.titleKey}`)
    assert.ok(hasKey(en, entry.blurbKey), `missing en string: ${entry.blurbKey}`)
    for (const field of entry.fields ?? []) {
      assert.ok(hasKey(en, field.labelKey), `missing en string: ${field.labelKey}`)
    }
  }
})

test('every settings section has a home in the console', () => {
  // The anti-drift clause. A new section fails this suite until it is placed,
  // and it is what would have caught ProfileSection and
  // PersonalPreferencesSection sitting in the barrel, rendered by nothing.
  //
  // The route sources are READ FROM THE DIRECTORY, not from a hand-written
  // list. A list here is the same duplicated-registry shape this whole suite
  // exists to catch: a new route added everywhere else still leaves the test
  // blind to it, and the failure mode is the test wrongly claiming a placed
  // section is homeless -- which teaches people to edit the test rather than
  // the thing it is checking.
  const elementsSource = read('./elements.tsx')
  const routesDir = resolve(HERE, '../routes')
  const routeSources = readdirSync(routesDir)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => readFileSync(resolve(routesDir, file), 'utf8'))
    .join('\n')

  for (const name of barrelExports()) {
    const referenced = elementsSource.includes(`'${name}'`) || routeSources.includes(name)
    assert.ok(referenced, `${name} is exported from the settings barrel but reachable from nowhere`)
  }
})

test('every field anchor is unique within its entry', () => {
  for (const entry of ADMIN_ENTRIES) {
    const anchors = (entry.fields ?? []).map((f) => f.anchor)
    assert.equal(
      new Set(anchors).size,
      anchors.length,
      `${entry.id} declares the same anchor twice`
    )
  }
})

test('every legacy redirect target is a real address', () => {
  const known = new Set(ADMIN_ENTRIES.map(adminEntryPath))
  for (const target of legacyTargets()) {
    assert.ok(known.has(target), `legacy redirect points at "${target}", which no entry serves`)
  }
})

test('adminEntryForPath prefers the longest match', () => {
  // A detail route has to highlight its parent rather than falling back to the
  // overview, whose path is a prefix of everything.
  assert.equal(adminEntryForPath('/admin')?.id, 'overview')
  assert.equal(adminEntryForPath('/admin/integrations/omdb')?.id, 'omdb')
  assert.equal(adminEntryForPath('/admin/access/users/42')?.id, 'users')
  assert.equal(adminEntryForPath('/recommendations'), undefined)
})

/**
 * Every anchor a field promises must exist in the DOM the section renders.
 *
 * This is the half of the field tier nothing else can check: a search result
 * whose anchor was renamed still navigates, still looks right, and silently
 * stops scrolling to anything. The scan expands the one templated form in use
 * (`id={`${idPrefix}-…`}`, which the algorithm card needs because it renders
 * twice) rather than only matching literals.
 */
function renderedIds(): Set<string> {
  const roots = [resolve(HERE, '../../settings'), resolve(HERE, '..')]
  const files: string[] = []

  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, item.name)
      if (item.isDirectory()) walk(full)
      else if (item.name.endsWith('.tsx')) files.push(full)
    }
  }
  roots.forEach(walk)

  const ids = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')

    /**
     * An `id=` sitting on its own line directly below a line that closes an
     * opening tag is a JSX *child*, not a prop — React renders it as literal
     * text and the element never gets the attribute. TypeScript accepts it
     * (children can be anything), lint accepts it, and a plain text search for
     * the anchor finds it, so this is the one shape that passes every other
     * check while producing an anchor that does not exist and a page with
     * `id=rec-movie-max-candidates` printed on it.
     */
    const lines = source.split('\n')
    const isChildNotProp = (lineIndex: number): boolean => {
      let j = lineIndex - 1
      while (j >= 0 && lines[j].trim() === '') j--
      return j >= 0 && /[^=]>\s*$/.test(lines[j])
    }

    lines.forEach((line, index) => {
      const standalone = /^\s*id=("([a-z0-9-]+)"|\{`\$\{idPrefix\}-[a-z0-9-]+`\})\s*$/.exec(line)
      if (standalone && isChildNotProp(index)) {
        throw new Error(
          `${file.split(/[\\/]/).pop()}:${index + 1} — \`${line.trim()}\` is a JSX child, ` +
            `not a prop. Move it inside the opening tag.`
        )
      }
    })

    for (const m of source.matchAll(/\bid="([a-z0-9-]+)"/g)) ids.add(m[1])

    // `idPrefix="rec-movie"` + id={`${idPrefix}-similarity-weight`}
    const prefixes = [...source.matchAll(/idPrefix="([a-z0-9-]+)"/g)].map((m) => m[1])
    const suffixes = [...source.matchAll(/id=\{`\$\{idPrefix\}-([a-z0-9-]+)`\}/g)].map((m) => m[1])
    for (const prefix of prefixes) {
      for (const suffix of suffixes) ids.add(`${prefix}-${suffix}`)
    }
  }
  return ids
}

test('every declared field anchor exists in a section', () => {
  const ids = renderedIds()
  for (const entry of ADMIN_ENTRIES) {
    for (const field of entry.fields ?? []) {
      assert.ok(
        ids.has(field.anchor),
        `${entry.id} promises anchor "#${field.anchor}", which no section renders`
      )
    }
  }
})
