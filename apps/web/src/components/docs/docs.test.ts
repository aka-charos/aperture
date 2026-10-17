import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve } from 'node:path'
import { consolePathIn } from '@/pages/admin/help/links'
import { appPathIn } from '@/pages/guide/routeDocs'
import { resolveDocHref, slugInFolder } from './docLinks'
import {
  ADMIN_DOCS_FOLDER,
  ADMIN_GUIDE_INDEX_FILE,
  USER_DOCS_FOLDER,
  USER_GUIDE_INDEX_FILE,
  USER_GUIDE_TRANSLATIONS,
  adminGuidePath,
  userDocsFolder,
  userGuideIndexFile,
  userGuidePath,
} from './guidePaths'
import { docHeadings, docSummary, githubSlug } from './markdown'
import { buildDocPages, filterDocPages } from './pages'

/**
 * The parts both guides share, and the one check that has to see both at
 * once: every link in every page the app shows — the admin pages, the user
 * pages and the two tables of contents — lands on a file that exists and, for
 * a page, on a heading it has. The guides link into each other, so a check
 * scoped to one folder cannot catch a link broken by a heading renamed in the
 * other.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../../..')

function markdownFiles(folder: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.md')) out.push(relative(REPO, full).split('\\').join('/'))
    }
  }
  walk(resolve(REPO, folder))
  return out
}

const SHOWN_FILES = [
  ...markdownFiles(ADMIN_DOCS_FOLDER),
  ...markdownFiles(USER_DOCS_FOLDER),
  ADMIN_GUIDE_INDEX_FILE,
  USER_GUIDE_INDEX_FILE,
  // Each translation of the user guide, checked the same way: its links are
  // real relative paths, and its anchors are its own headings.
  ...USER_GUIDE_TRANSLATIONS.flatMap((language) => {
    const folder = userDocsFolder(language)
    const index = userGuideIndexFile(language)
    return [
      ...(existsSync(resolve(REPO, folder)) ? markdownFiles(folder) : []),
      ...(existsSync(resolve(REPO, index)) ? [index] : []),
    ]
  }),
]

const read = (file: string) => readFileSync(resolve(REPO, file), 'utf8')
const anchorsOf = (file: string) => new Set(docHeadings(read(file)).map((h) => h.slug))

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

test('both guides find their pages', () => {
  assert.ok(markdownFiles(ADMIN_DOCS_FOLDER).length > 40, 'no admin pages found')
  assert.ok(markdownFiles(USER_DOCS_FOLDER).length > 25, 'no user pages found')
})

test('every link in a page the app shows lands on a file, and on a heading when it names one', () => {
  for (const file of SHOWN_FILES) {
    for (const [line, text] of proseLines(read(file))) {
      // Images are never drawn in the app; only real links are checked.
      for (const match of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const where = `${file}:${line} → ${match[1]}`
        const link = resolveDocHref(match[1], file)

        if (link.kind === 'file') {
          assert.ok(existsSync(resolve(REPO, link.path)), `${where}: ${link.path} does not exist`)
          if (link.anchor && link.path.endsWith('.md')) {
            assert.ok(anchorsOf(link.path).has(link.anchor), `${where}: no such heading`)
          }
        } else if (link.kind === 'anchor') {
          assert.ok(anchorsOf(file).has(link.anchor), `${where}: no such heading on this page`)
        } else if (link.kind === 'app') {
          assert.ok(
            consolePathIn(link.path) ?? appPathIn(link.path),
            `${where}: no screen in the app answers to ${link.path}`
          )
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

test('resolveDocHref resolves against the file the link was written in', () => {
  const admin = 'docs/admin/tmdb.md'
  const nested = 'docs/features/user-settings/preferences.md'
  assert.deepEqual(resolveDocHref('smtp.md#account-drift', admin), {
    kind: 'file', path: 'docs/admin/smtp.md', anchor: 'account-drift',
  })
  assert.deepEqual(resolveDocHref('./omdb.md', admin), { kind: 'file', path: 'docs/admin/omdb.md', anchor: undefined })
  assert.deepEqual(resolveDocHref('../features/discovery.md', admin), {
    kind: 'file', path: 'docs/features/discovery.md', anchor: undefined,
  })
  assert.deepEqual(resolveDocHref('../ratings.md', nested), { kind: 'file', path: 'docs/features/ratings.md', anchor: undefined })
  assert.deepEqual(resolveDocHref('ai-algorithm.md', nested), {
    kind: 'file', path: 'docs/features/user-settings/ai-algorithm.md', anchor: undefined,
  })
  assert.deepEqual(resolveDocHref('#installing-pgvector', admin), { kind: 'anchor', anchor: 'installing-pgvector' })
  assert.deepEqual(resolveDocHref('https://n8n.io', admin), { kind: 'external', href: 'https://n8n.io' })
  assert.deepEqual(resolveDocHref('mailto:a@b.c', admin), { kind: 'external', href: 'mailto:a@b.c' })
  assert.deepEqual(resolveDocHref('/admin/ops/jobs/', admin), { kind: 'app', path: '/admin/ops/jobs' })
})

test('slugInFolder keeps the subfolder and refuses anything outside', () => {
  assert.equal(slugInFolder('docs/features/user-settings/preferences.md', 'docs/features'), 'user-settings/preferences')
  assert.equal(slugInFolder('docs/features/ratings.md', 'docs/features'), 'ratings')
  assert.equal(slugInFolder('docs/admin/tmdb.md', 'docs/features'), null)
  assert.equal(slugInFolder('docs/features-old/x.md', 'docs/features'), null)
  assert.equal(slugInFolder('docs/features/release-notes/', 'docs/features'), null)
})

test('buildDocPages reads the repository path back out of a glob key', () => {
  const pages = buildDocPages(
    {
      '../../../../../docs/features/ratings.md': '# Ratings\n\nStars, one to ten.\n',
      '../../../../../docs/features/user-settings/preferences.md': '# Preferences\n\nLanguage and more.\n',
      '../../../../../docs/admin/tmdb.md': '# TMDb\n\nNot this folder.\n',
    },
    'docs/features'
  )
  assert.deepEqual([...pages.keys()].sort(), ['ratings', 'user-settings/preferences'])
  assert.equal(pages.get('user-settings/preferences')?.file, 'docs/features/user-settings/preferences.md')
  assert.equal(pages.get('ratings')?.summary, 'Stars, one to ten.')
  assert.deepEqual(filterDocPages(pages, ['ratings', 'user-settings/preferences'], 'LANGUAGE'), ['user-settings/preferences'])
  assert.deepEqual(filterDocPages(pages, ['ratings'], '  '), ['ratings'])
})

test('each guide has its own address', () => {
  assert.equal(adminGuidePath(), '/admin/help')
  assert.equal(adminGuidePath('smtp', 'account-drift'), '/admin/help/smtp#account-drift')
  assert.equal(userGuidePath(), '/help')
  assert.equal(userGuidePath('user-settings/home-screen'), '/help/user-settings/home-screen')
})
