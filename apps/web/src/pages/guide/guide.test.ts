import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve } from 'node:path'
import {
  USER_DOCS_FOLDER,
  USER_GUIDE_INDEX_FILE,
  USER_GUIDE_TRANSLATIONS,
  userDocsFolder,
  userGuideIndexFile,
} from '@/components/docs/guidePaths'
import { docSummary, docTitle } from '@/components/docs/markdown'
import { parseGuideIndex } from './guideIndex'
import { userLinkTarget } from './links'
import { ROUTE_DOCS, appPathIn, docsForLocation, hintForLocation, screenForDoc, tourForLocation } from './routeDocs'

/**
 * What keeps the in-app user guide honest. The pages ship inside the web
 * bundle from `docs/features/`, and the Help button names them by path, so a
 * renamed page breaks the button on one screen without any build noticing.
 * These checks run over the real files. Links between pages are checked for
 * both guides together in `components/docs/docs.test.ts`.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../../..')
const FOLDER = resolve(REPO, USER_DOCS_FOLDER)

const PAGES = new Map<string, string>()
;(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (name.endsWith('.md')) {
      const slug = relative(FOLDER, full).split('\\').join('/').slice(0, -'.md'.length)
      PAGES.set(slug, readFileSync(full, 'utf8'))
    }
  }
})(FOLDER)

const INDEX = readFileSync(resolve(REPO, USER_GUIDE_INDEX_FILE), 'utf8')

test('the pages are where the bundle looks for them', () => {
  assert.ok(PAGES.size > 25, `expected the user pages in ${FOLDER}, found ${PAGES.size}`)
  assert.ok(PAGES.has('user-settings/recommendations'), 'pages in subfolders are not being found')
})

test('every page is reachable from the contents in docs/user-guide.md', () => {
  const sections = parseGuideIndex(INDEX, USER_GUIDE_INDEX_FILE, (slug) => PAGES.has(slug))
  const reached = new Set(sections.flatMap((s) => s.items.map((i) => i.slug)))
  for (const slug of PAGES.keys()) {
    assert.ok(reached.has(slug), `docs/features/${slug}.md is not listed in docs/user-guide.md, so the app never shows it`)
  }
})

test('every page has a title and an opening summary', () => {
  for (const [slug, markdown] of PAGES) {
    assert.notEqual(docTitle(markdown, ''), '', `docs/features/${slug}.md has no "# Title" line`)
    assert.notEqual(docSummary(markdown), '', `docs/features/${slug}.md does not open with a paragraph`)
  }
})

test('every page the Help button names exists', () => {
  for (const entry of ROUTE_DOCS) {
    for (const slug of entry.docs) {
      assert.ok(PAGES.has(slug), `${entry.path} names docs/features/${slug}.md, which does not exist`)
      assert.ok(existsSync(resolve(FOLDER, `${slug}.md`)))
    }
  }
})

// A translation is read page by page over the English set, so a page it has
// that English does not would never be shown, and a page it leaves out falls
// back to English. Both are checked for every translated language.
for (const lang of USER_GUIDE_TRANSLATIONS) {
  const folder = resolve(REPO, userDocsFolder(lang))
  const pages = new Map<string, string>()
  ;(function walk(dir: string) {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.md')) {
        const slug = relative(folder, full).split('\\').join('/').slice(0, -'.md'.length)
        pages.set(slug, readFileSync(full, 'utf8'))
      }
    }
  })(folder)

  test(`the ${lang} pages each translate an English page`, () => {
    for (const slug of pages.keys()) {
      assert.ok(PAGES.has(slug), `${userDocsFolder(lang)}/${slug}.md has no English page at docs/features/${slug}.md`)
    }
  })

  test(`every ${lang} page has a title and an opening summary`, () => {
    for (const [slug, markdown] of pages) {
      assert.notEqual(docTitle(markdown, ''), '', `${userDocsFolder(lang)}/${slug}.md has no "# Title" line`)
      assert.notEqual(docSummary(markdown), '', `${userDocsFolder(lang)}/${slug}.md does not open with a paragraph`)
    }
  })

  test(`the ${lang} contents reach every ${lang} page`, () => {
    const indexFile = userGuideIndexFile(lang)
    if (!existsSync(resolve(REPO, indexFile))) return
    const index = readFileSync(resolve(REPO, indexFile), 'utf8')
    const sections = parseGuideIndex(index, indexFile, (slug) => PAGES.has(slug))
    const reached = new Set(sections.flatMap((s) => s.items.map((i) => i.slug)))
    for (const slug of pages.keys()) {
      assert.ok(reached.has(slug), `${userDocsFolder(lang)}/${slug}.md is not listed in ${indexFile}`)
    }
  })
}

test('parseGuideIndex reads sections and entries, and drops the rest', () => {
  const md = [
    '# Guide',
    'Intro with a [link](features/ratings.md).',
    '## For Administrators',
    '- [Setup](admin-guide.md) - Configuration',
    '## Rating',
    '1. [Ratings](features/ratings.md) - Stars, **one** to ten',
    '2. [Ratings again](features/ratings.md) - duplicate',
    '3. [Gone](features/gone.md) - not a page',
    '## Settings',
    '- [Preferences](features/user-settings/preferences.md)',
    '## Quick Reference',
    '| Need | Go To |',
    '| a | [Ratings](features/ratings.md) |',
  ].join('\n')
  const known = (slug: string) => slug === 'ratings' || slug === 'user-settings/preferences'
  assert.deepEqual(parseGuideIndex(md, 'docs/user-guide.md', known), [
    { heading: 'Rating', items: [{ slug: 'ratings', blurb: 'Stars, one to ten' }] },
    { heading: 'Settings', items: [{ slug: 'user-settings/preferences', blurb: '' }] },
  ])
})

test('docsForLocation picks the pages for the screen', () => {
  assert.deepEqual(docsForLocation('/'), ['dashboard', 'getting-started'])
  assert.deepEqual(docsForLocation('/browse/'), ['browse', 'grid-list-views'])
  assert.equal(docsForLocation('/movies/123')[0], 'movie-detail')
  assert.equal(docsForLocation('/series/abc')[0], 'series-detail')
  assert.deepEqual(docsForLocation('/settings', '?tab=home'), ['user-settings/home-screen'])
  assert.deepEqual(docsForLocation('/settings', '?tab=display'), ['user-settings/display', 'similarity-graphs', 'getting-started'])
  assert.deepEqual(docsForLocation('/settings'), ['user-settings/recommendations'])
  // A retired tab name gets the pages for the tab it now opens.
  assert.deepEqual(docsForLocation('/settings', '?tab=preferences'), ['user-settings/display', 'similarity-graphs', 'getting-started'])
  assert.deepEqual(docsForLocation('/settings', '?tab=algorithm'), ['user-settings/recommendations'])
  assert.deepEqual(docsForLocation('/no-such-screen'), [])
  assert.deepEqual(docsForLocation('/admin/ops/jobs'), [])
})

test('screenForDoc and appPathIn name only exact screens', () => {
  assert.equal(screenForDoc('browse'), '/browse')
  assert.equal(screenForDoc('user-settings/home-screen'), '/settings?tab=home')
  assert.equal(screenForDoc('movie-detail'), null)
  assert.equal(appPathIn('/recommendations'), '/recommendations')
  assert.equal(appPathIn('/movies/'), '/movies')
  assert.equal(appPathIn('/movies/:id'), null)
  assert.equal(appPathIn('recommendations'), null)
})

test('userLinkTarget shows admin pages to admins only', () => {
  const from = 'docs/features/user-settings/recommendations.md'
  const known = (slug: string) => PAGES.has(slug)
  assert.deepEqual(userLinkTarget('../ratings.md#x', from, known, false), {
    kind: 'page', slug: 'ratings', anchor: 'x', href: '/help/ratings#x',
  })
  assert.deepEqual(userLinkTarget('../../admin/smtp.md', from, known, false), { kind: 'text' })
  assert.deepEqual(userLinkTarget('../../admin/smtp.md', from, known, true), { kind: 'route', href: '/admin/help/smtp' })
  assert.deepEqual(userLinkTarget('../../admin-guide.md', from, known, true), { kind: 'route', href: '/admin/help' })
  assert.deepEqual(userLinkTarget('../../user-guide.md', from, known, false), { kind: 'route', href: '/help' })
  assert.deepEqual(userLinkTarget('/recommendations', from, known, false), { kind: 'route', href: '/recommendations' })
  assert.deepEqual(userLinkTarget('../../api-reference.md', from, known, true), { kind: 'text' })
})

test('a screen names its tour and its first-visit hint through the same table', () => {
  assert.equal(tourForLocation('/'), 'home')
  assert.equal(tourForLocation('/movies/123'), 'title')
  assert.equal(tourForLocation('/settings', '?tab=algorithm'), 'settings-recommendations')
  assert.equal(tourForLocation('/history'), null)
  assert.equal(hintForLocation('/browse/'), 'browse')
  // Explore fills the viewport; a line above it would push the graph down.
  assert.equal(hintForLocation('/explore'), null)
  assert.equal(tourForLocation('/explore'), 'explore')
})
