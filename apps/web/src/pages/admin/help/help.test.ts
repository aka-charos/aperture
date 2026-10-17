import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { ADMIN_ENTRIES, adminEntryPath } from '../nav/registry'
import { guideDocSlugs, guideSections } from './guide'
import { docSummary, docTitle } from '@/components/docs/markdown'
import { adminLinkTarget, consolePathIn, guideDocPath } from './links'

/**
 * What keeps the in-app admin guide honest.
 *
 * The pages are compiled into the web bundle from `docs/admin/`, and they name
 * the console constantly — "Admin console → Integrations → TMDB
 * (`/admin/integrations/tmdb`)" — so a renamed route turns them wrong without
 * any build noticing. Read in the app, beside the page they describe, a stale
 * address is worse than on GitHub: the reader is standing in the console and
 * can see it is not true. These checks run over the real files.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../../../..')
const DOCS_DIR = resolve(REPO, 'docs/admin')

const PAGES = new Map(
  readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => [name.slice(0, -3), readFileSync(resolve(DOCS_DIR, name), 'utf8')])
)

/** Lines outside code fences, numbered from 1, so a code sample is never read as prose. */
function proseLines(markdown: string): Array<[number, string]> {
  const out: Array<[number, string]> = []
  let inFence = false
  markdown.split(/\r?\n/).forEach((line, i) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence
      return
    }
    if (!inFence) out.push([i + 1, line])
  })
  return out
}

test('the pages are where the bundle looks for them', () => {
  // docs.ts globs this folder; an empty glob builds fine and ships a guide with
  // no pages in it.
  assert.ok(PAGES.size > 40, `expected the admin pages in ${DOCS_DIR}, found ${PAGES.size}`)
})

test('every page a section names exists', () => {
  for (const entry of ADMIN_ENTRIES) {
    for (const slug of entry.docs ?? []) {
      assert.ok(PAGES.has(slug), `${entry.id} names docs/admin/${slug}.md, which does not exist`)
    }
  }
  for (const section of guideSections()) {
    for (const slug of section.docs) {
      assert.ok(PAGES.has(slug), `the guide index lists docs/admin/${slug}.md, which does not exist`)
    }
  }
})

test('every page is reachable from the guide index', () => {
  const reached = guideDocSlugs()
  for (const slug of PAGES.keys()) {
    assert.ok(
      reached.has(slug),
      `docs/admin/${slug}.md is in no section's docs and in no guide topic, so the app never shows it`
    )
  }
})

test('every page has a title and an opening summary', () => {
  for (const [slug, markdown] of PAGES) {
    assert.notEqual(docTitle(markdown, ''), '', `docs/admin/${slug}.md has no "# Title" line`)
    assert.notEqual(docSummary(markdown), '', `docs/admin/${slug}.md does not open with a paragraph`)
  }
})

test('every console address a page names is a real section', () => {
  const known = new Set(ADMIN_ENTRIES.map(adminEntryPath))
  for (const [slug, markdown] of PAGES) {
    for (const [line, text] of proseLines(markdown)) {
      for (const match of text.matchAll(/`(\/admin(?:\/[a-z0-9-]+)*)\/?`/g)) {
        assert.ok(
          known.has(match[1]),
          `docs/admin/${slug}.md:${line} names ${match[1]}, which no section serves`
        )
      }
    }
  }
})

test('consolePathIn links only real sections', () => {
  assert.equal(consolePathIn('/admin/integrations/smtp'), '/admin/integrations/smtp')
  assert.equal(consolePathIn('/admin/integrations/smtp/'), '/admin/integrations/smtp')
  assert.equal(consolePathIn('/admin'), '/admin')
  assert.equal(consolePathIn('/admin/integrations/nope'), null)
  assert.equal(consolePathIn('sync-movies'), null)
})

test('guideDocPath is under the guide entry', () => {
  assert.equal(guideDocPath('smtp'), '/admin/help/smtp')
  assert.equal(guideDocPath('smtp', 'account-drift'), '/admin/help/smtp#account-drift')
})

test('adminLinkTarget routes each kind of link', () => {
  const from = 'docs/admin/tmdb.md'
  const known = (slug: string) => PAGES.has(slug)
  assert.deepEqual(adminLinkTarget('smtp.md#account-drift', from, known), {
    kind: 'page', slug: 'smtp', anchor: 'account-drift', href: '/admin/help/smtp#account-drift',
  })
  assert.deepEqual(adminLinkTarget('../features/discovery.md', from, known), { kind: 'route', href: '/help/discovery' })
  assert.deepEqual(adminLinkTarget('../user-guide.md', from, known), { kind: 'route', href: '/help' })
  assert.deepEqual(adminLinkTarget('../api-reference.md#gap', from, known), { kind: 'text' })
  assert.deepEqual(adminLinkTarget('/admin/ops/jobs/', from, known), { kind: 'route', href: '/admin/ops/jobs' })
  assert.deepEqual(adminLinkTarget('nope.md', from, known), { kind: 'text' })
})
