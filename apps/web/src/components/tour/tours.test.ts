import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve } from 'node:path'
import { docHeadings } from '@/components/docs/markdown'
import { USER_GUIDE_TRANSLATIONS, userDocsFolder } from '@/components/docs/guidePaths'
import { translatedAnchor } from '@/pages/guide/translatedAnchor'
import { ROUTE_DOCS } from '@/pages/guide/routeDocs'
import { TOURS, resolveSteps, stepItemKey, stepKey, isTourId, type TourAudience } from './tours'

/**
 * What keeps the tours, the first-visit hints and the inline ? icons honest.
 * A tour names its elements by `data-tour` value and its text by key, and a
 * hint or a ? icon names a guide page by path — and none of those is checked
 * by a build. A renamed element would make a step quietly show centred
 * forever; a renamed page would open an empty drawer. These run over the real
 * source, strings and pages.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../..')
const REPO = resolve(SRC, '../../..')
const DOCS = resolve(REPO, 'docs/features')

const SOURCES = new Map<string, string>()
;(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) SOURCES.set(full, readFileSync(full, 'utf8'))
  }
})(SRC)

const PAGES = new Map<string, string>()
;(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (name.endsWith('.md')) {
      PAGES.set(relative(DOCS, full).split('\\').join('/').slice(0, -'.md'.length), readFileSync(full, 'utf8'))
    }
  }
})(DOCS)

const EN = JSON.parse(readFileSync(resolve(SRC, 'i18n/locales/en/translation.json'), 'utf8')) as Record<string, unknown>

function hasKey(dotted: string): boolean {
  let node: unknown = EN
  for (const part of dotted.split('.')) {
    if (typeof node !== 'object' || node === null) return false
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string'
}

/**
 * Every anchor an element can carry: `data-tour="x"`, a conditional
 * `data-tour={i === 0 ? 'x' : undefined}`, and the two props that pass one
 * through (`tourAnchor` on a sidebar entry and on a settings card).
 */
function anchorsInSource(): Set<string> {
  const found = new Set<string>()
  for (const source of SOURCES.values()) {
    for (const m of source.matchAll(/data-tour="([a-z0-9-]+)"/g)) found.add(m[1])
    for (const m of source.matchAll(/data-tour=\{[^}]*?'([a-z0-9-]+)'/g)) found.add(m[1])
    for (const m of source.matchAll(/tourAnchor(?::\s*|=)['"]([a-z0-9-]+)['"]/g)) found.add(m[1])
  }
  return found
}

function headingSlugs(slug: string): Set<string> {
  return new Set(docHeadings(PAGES.get(slug) ?? '').map((h) => h.slug))
}

test('the scan sees the source and the pages', () => {
  assert.ok(SOURCES.size > 200, `expected the web source under ${SRC}, found ${SOURCES.size} files`)
  assert.ok(PAGES.has('recommendations'), `expected the user guide under ${DOCS}`)
})

test('every element a tour points at exists', () => {
  const anchors = anchorsInSource()
  for (const tour of Object.values(TOURS)) {
    for (const step of tour.steps) {
      if (!step.anchor) continue
      assert.ok(
        anchors.has(step.anchor),
        `${tour.id}/${step.id} points at data-tour="${step.anchor}", which no element carries`
      )
    }
  }
})

test('a data-tour value never sits on its own line as a JSX child', () => {
  // Below a line that closes an opening tag, `data-tour="x"` is text React
  // prints on the page, not an attribute — and the scan above would still
  // find it. Same trap as the admin registry's anchors.
  for (const [file, source] of SOURCES) {
    const lines = source.split('\n')
    lines.forEach((line, index) => {
      if (!/^\s*data-tour=/.test(line)) return
      let j = index - 1
      while (j >= 0 && lines[j].trim() === '') j--
      assert.ok(
        !(j >= 0 && /[^=]>\s*$/.test(lines[j])),
        `${relative(SRC, file)}:${index + 1} — \`${line.trim()}\` is a JSX child, not a prop`
      )
    })
  }
})

test('every step has its words', () => {
  for (const tour of Object.values(TOURS)) {
    for (const step of tour.steps) {
      for (const part of ['title', 'body'] as const) {
        assert.ok(hasKey(stepKey(tour.id, step.id, part)), `missing ${stepKey(tour.id, step.id, part)} in en`)
      }
      for (const item of step.items ?? []) {
        assert.ok(hasKey(stepItemKey(tour.id, step.id, item.id)), `missing ${stepItemKey(tour.id, step.id, item.id)} in en`)
      }
    }
  }
})

test('every guide page and heading a step links to exists', () => {
  for (const tour of Object.values(TOURS)) {
    for (const step of tour.steps) {
      if (!step.doc) continue
      assert.ok(PAGES.has(step.doc.slug), `${tour.id}/${step.id} links to docs/features/${step.doc.slug}.md, which does not exist`)
      if (step.doc.anchor) {
        assert.ok(headingSlugs(step.doc.slug).has(step.doc.anchor), `${tour.id}/${step.id}: no heading #${step.doc.anchor} in ${step.doc.slug}`)
      }
    }
  }
})

test('every tour and hint a screen names exists and has its words', () => {
  for (const entry of ROUTE_DOCS) {
    if (entry.tour) assert.ok(isTourId(entry.tour), `${entry.path} names tour "${entry.tour}", which tours.ts does not define`)
    if (entry.hint) assert.ok(hasKey(`onboarding.hints.${entry.hint}`), `missing onboarding.hints.${entry.hint} in en`)
  }
})

test('every inline ? icon opens a page and heading that exist', () => {
  let count = 0
  for (const [file, source] of SOURCES) {
    for (const m of source.matchAll(/<HelpHint\b([^>]*)\/>/g)) {
      count++
      const doc = /\bdoc="([^"]+)"/.exec(m[1])?.[1]
      const anchor = /\banchor="([^"]+)"/.exec(m[1])?.[1]
      const where = relative(SRC, file)
      assert.ok(doc, `${where}: a HelpHint whose doc is not a string literal cannot be checked`)
      assert.ok(PAGES.has(doc!), `${where}: HelpHint opens docs/features/${doc}.md, which does not exist`)
      if (anchor) assert.ok(headingSlugs(doc!).has(anchor), `${where}: no heading #${anchor} in ${doc}`)
    }
  }
  assert.ok(count >= 3, `expected the inline ? icons, found ${count}`)
})

test('every checklist item the server can send has its words', () => {
  // Mirrors ChecklistItemId in core onboarding/rules.ts (the bundle never
  // imports core); a new item there needs its words here.
  for (const id of ['watch', 'rate', 'interest', 'why', 'assistant', 'watching']) {
    assert.ok(hasKey(`onboarding.checklist.items.${id}.title`), `missing onboarding.checklist.items.${id}.title`)
    assert.ok(hasKey(`onboarding.checklist.items.${id}.detail`), `missing onboarding.checklist.items.${id}.detail`)
  }
  for (const state of ['ready', 'pending']) {
    assert.ok(hasKey(`onboarding.checklist.recommendations.${state}`), `missing onboarding.checklist.recommendations.${state}`)
  }
})

/** Every (page, heading) the app opens the guide at: tour steps and inline ? icons. */
function namedAnchors(): { slug: string; anchor: string; where: string }[] {
  const out: { slug: string; anchor: string; where: string }[] = []
  for (const tour of Object.values(TOURS)) {
    for (const step of tour.steps) {
      if (step.doc?.anchor) out.push({ slug: step.doc.slug, anchor: step.doc.anchor, where: `${tour.id}/${step.id}` })
    }
  }
  for (const [file, source] of SOURCES) {
    for (const m of source.matchAll(/<HelpHint\b([^>]*)\/>/g)) {
      const slug = /\bdoc="([^"]+)"/.exec(m[1])?.[1]
      const anchor = /\banchor="([^"]+)"/.exec(m[1])?.[1]
      if (slug && anchor) out.push({ slug, anchor, where: relative(SRC, file) })
    }
  }
  return out
}

test('every anchor the app names lands on the same section of each translation', () => {
  // A translated page's heading ids are its own (Greek slugs), so an English
  // anchor is carried over by position; this fails when a translation stops
  // mirroring the English headings where an anchor points.
  const anchors = namedAnchors()
  assert.ok(anchors.length >= 3, `expected the named anchors, found ${anchors.length}`)
  for (const lang of USER_GUIDE_TRANSLATIONS) {
    for (const { slug, anchor, where } of anchors) {
      const file = resolve(REPO, userDocsFolder(lang), `${slug}.md`)
      if (!existsSync(file)) continue
      const english = docHeadings(PAGES.get(slug) ?? '')
      const shown = docHeadings(readFileSync(file, 'utf8'))
      assert.ok(
        translatedAnchor(english, shown, anchor),
        `${where}: #${anchor} has no matching heading in the ${lang} page ${slug}.md`
      )
    }
  }
})

test('an anchor maps by position and refuses a heading that no longer lines up', () => {
  const english = [{ slug: 'a', depth: 2 }, { slug: 'b', depth: 3 }]
  assert.equal(translatedAnchor(english, english, 'b'), 'b')
  assert.equal(translatedAnchor(english, [{ slug: 'α', depth: 2 }, { slug: 'β', depth: 3 }], 'b'), 'β')
  assert.equal(translatedAnchor(english, [{ slug: 'α', depth: 2 }, { slug: 'β', depth: 2 }], 'b'), undefined)
  assert.equal(translatedAnchor(english, [{ slug: 'α', depth: 2 }], 'b'), undefined)
  // An untranslated page IS the English page: the anchor passes through.
  assert.equal(translatedAnchor(english, english, 'b'), 'b')
  assert.equal(translatedAnchor(english, [{ slug: 'α', depth: 2 }, { slug: 'β', depth: 3 }], 'missing'), undefined)
})

const NOBODY: TourAudience = { capabilities: {}, features: {} }
const EVERYTHING: TourAudience = {
  capabilities: { assistant: true, discover: true, social: true, collections: true },
  features: { watching: true },
}

test('a gated step is shown only to someone the server granted it', () => {
  const ids = (audience: TourAudience) => resolveSteps(TOURS.welcome, audience).map((s) => s.id)
  assert.ok(ids(EVERYTHING).includes('assistant'))
  assert.ok(!ids(NOBODY).includes('assistant'))
})

test('a list step keeps only the lines the person has', () => {
  const more = (audience: TourAudience) =>
    resolveSteps(TOURS.welcome, audience).find((s) => s.id === 'more')?.items?.map((i) => i.id)
  assert.deepEqual(more(NOBODY), ['topPicks', 'explore'])
  assert.deepEqual(more(EVERYTHING), ['topPicks', 'watching', 'discover', 'watchThis', 'collections', 'explore'])
})

test('a feature whose answer has not arrived reads as off', () => {
  const more = resolveSteps(TOURS.welcome, { capabilities: {}, features: {} }).find((s) => s.id === 'more')
  assert.ok(!more?.items?.some((i) => i.id === 'watching'))
})

test('no tour resolves to nothing, whoever is looking', () => {
  for (const tour of Object.values(TOURS)) {
    assert.ok(resolveSteps(tour, NOBODY).length > 0, `${tour.id} has no step for someone with no extra features`)
  }
})
