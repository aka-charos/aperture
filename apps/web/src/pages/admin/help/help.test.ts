import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { ADMIN_ENTRIES, adminEntryPath } from '../nav/registry'
import { guideDocSlugs, guideSections } from './guide'
import { consolePathIn, guideDocPath, resolveDocHref } from './links'
import { docHeadings, docSummary, docTitle, githubSlug } from './markdown'

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

test('every link between pages lands on a page and a heading', () => {
  const anchorsOf = (slug: string) => new Set(docHeadings(PAGES.get(slug) ?? '').map((h) => h.slug))

  for (const [slug, markdown] of PAGES) {
    for (const [line, text] of proseLines(markdown)) {
      // Images are dropped in the app (the screenshots show the console before
      // it was redesigned), so only real links are checked here.
      for (const match of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const where = `docs/admin/${slug}.md:${line} → ${match[1]}`
        const link = resolveDocHref(match[1])

        if (link.kind === 'doc') {
          assert.ok(PAGES.has(link.slug), `${where}: no such page`)
          if (link.anchor) {
            assert.ok(anchorsOf(link.slug).has(link.anchor), `${where}: no such heading`)
          }
        } else if (link.kind === 'anchor') {
          assert.ok(anchorsOf(slug).has(link.anchor), `${where}: no such heading on this page`)
        } else if (link.kind === 'outside') {
          assert.ok(existsSync(resolve(REPO, link.path)), `${where}: ${link.path} does not exist`)
        } else if (link.kind === 'section') {
          assert.ok(consolePathIn(link.path), `${where}: no such section`)
        }
      }
    }
  }
})

test('githubSlug follows GitHub', () => {
  assert.equal(githubSlug('Accounts No Longer on the Media Server'), 'accounts-no-longer-on-the-media-server')
  assert.equal(githubSlug('Logo & Favicon'), 'logo--favicon')
  assert.equal(githubSlug('What Emails Look Like'), 'what-emails-look-like')
  assert.equal(githubSlug('Step 2: Install pgvector'), 'step-2-install-pgvector')
  assert.equal(githubSlug('Über `config`'), 'über-config')
})

test('docHeadings skips code fences and numbers repeats the way GitHub does', () => {
  const md = ['# Title', '', '```bash', '# not a heading', '```', '## Setup', 'text', '## Setup', '### **Bold** `code`'].join('\n')
  assert.deepEqual(
    docHeadings(md).map((h) => [h.line, h.depth, h.slug]),
    [
      [1, 1, 'title'],
      [6, 2, 'setup'],
      [8, 2, 'setup-1'],
      [9, 3, 'bold-code'],
    ]
  )
})

test('docSummary is the opening paragraph and nothing else', () => {
  assert.equal(
    docSummary('# T\n\nThe **mail** server, see [SMTP](smtp.md).\nSecond line.\n\n## Next'),
    'The mail server, see SMTP. Second line.'
  )
  assert.equal(docSummary('# T\n\n| a | b |\n|---|---|'), '')
  assert.equal(docSummary('# T\n\n![shot](x.png)\n\nText'), '')
})

test('resolveDocHref routes each kind of link', () => {
  assert.deepEqual(resolveDocHref('smtp.md#account-drift'), { kind: 'doc', slug: 'smtp', anchor: 'account-drift' })
  assert.deepEqual(resolveDocHref('./tmdb.md'), { kind: 'doc', slug: 'tmdb', anchor: undefined })
  assert.deepEqual(resolveDocHref('../admin/omdb.md'), { kind: 'doc', slug: 'omdb', anchor: undefined })
  assert.deepEqual(resolveDocHref('#installing-pgvector'), { kind: 'anchor', anchor: 'installing-pgvector' })
  assert.deepEqual(resolveDocHref('../features/discovery.md'), { kind: 'outside', path: 'docs/features/discovery.md' })
  assert.deepEqual(resolveDocHref('../api-reference.md#gap'), { kind: 'outside', path: 'docs/api-reference.md' })
  assert.deepEqual(resolveDocHref('https://n8n.io'), { kind: 'external', href: 'https://n8n.io' })
  assert.deepEqual(resolveDocHref('mailto:a@b.c'), { kind: 'external', href: 'mailto:a@b.c' })
  assert.deepEqual(resolveDocHref('/admin/ops/jobs/'), { kind: 'section', path: '/admin/ops/jobs' })
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
