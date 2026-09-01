import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { searchAdmin } from './search'
import {
  ALL_JOB_NAMES,
  JOB_DISPLAY_NAME_KEYS,
  jobAnchor,
  titleCaseJobName,
} from '@/pages/jobs/registry'

/**
 * What the settings palette must find.
 *
 * The first version matched the whole query as one string, on the reasoning
 * that settings names are often two words and splitting them makes two weak
 * matches instead of one strong one. That reasoning ignored how anyone
 * actually types: nobody reproduces a label verbatim, they name the area and
 * the thing. `ai embedding model`, `novelty weight`, `backup database` and
 * `trusted proxy` all returned **nothing**, because no single indexed string
 * contains any of them — the words are spread across the group name, the
 * title, the blurb and the aliases, which is where you would expect them.
 *
 * These are phrasings a person would plausibly type, pinned against the real
 * registry and the real English strings. A query here returning nothing is the
 * regression; the exact ordering below the first hit is not pinned, because
 * that is tuning and it should be free to move.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const en = JSON.parse(
  readFileSync(resolve(HERE, '../../../i18n/locales/en/translation.json'), 'utf8')
) as Record<string, unknown>

/** Stands in for i18next: resolves a dotted key, or returns the key. */
const t = (key: string): string => {
  let node: unknown = en
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : key
}

const idsFor = (query: string) => searchAdmin(query, t).map((r) => r.entryId)
const topFor = (query: string) => searchAdmin(query, t)[0]

test('a multi-word query finds the thing it describes', () => {
  // The report that prompted this: the words are split across the group name
  // ("AI models"), a title ("Embeddings") and an alias ("embeddings model").
  for (const query of ['ai embedding model', 'embedding model', 'embeddings model']) {
    const ids = idsFor(query)
    assert.ok(ids.length > 0, `"${query}" found nothing`)
    assert.ok(
      ids.includes('ai-roles') || ids.includes('embeddings'),
      `"${query}" found ${ids.join(', ')} — neither AI page`
    )
  }
})

test('naming a control by area plus word reaches the control', () => {
  // "novelty weight": the slider is labelled "Genre Discovery" and only its
  // section says "weights", so neither word alone is enough.
  const hit = searchAdmin('novelty weight', t).find((r) => r.parentTitle)
  assert.ok(hit, 'no field-level result for "novelty weight"')
  assert.equal(hit.entryId, 'algorithm')
  assert.ok(hit.path.includes('#'), 'a field result must carry its anchor')
})

test('queries that used to return nothing now resolve', () => {
  const cases: Array<[query: string, expected: string]> = [
    ['backup database', 'backup'],
    ['trusted proxy', 'deployment'],
    ['omdb key', 'omdb'],
    ['purge', 'database'],
    ['rotten tomatoes', 'omdb'],
    ['theme colour', 'theme-colors'],
  ]
  for (const [query, expected] of cases) {
    const ids = idsFor(query)
    assert.ok(ids.length > 0, `"${query}" found nothing`)
    assert.ok(ids.includes(expected), `"${query}" did not reach ${expected} (got ${ids.join(', ')})`)
  }
})

test('covering more of the query outranks scoring higher on less of it', () => {
  // Both words hit "Backup & restore"; only one hits "Database". A result that
  // answers the whole phrase has to come first or the ranking is decorative.
  const top = topFor('backup database')
  assert.equal(top?.entryId, 'backup')
})

test('a stray word degrades to the best partial match rather than nothing', () => {
  // Strict AND would return nothing here, which is the failure being fixed —
  // just in a politer disguise.
  const ids = idsFor('the api key please')
  assert.ok(ids.length > 0, 'a query with filler words found nothing')
})

test('an empty or whitespace query returns nothing', () => {
  assert.equal(searchAdmin('', t).length, 0)
  assert.equal(searchAdmin('   ', t).length, 0)
})

test('a single word still finds its section', () => {
  assert.ok(idsFor('jobs').includes('jobs'))
  assert.ok(idsFor('embedding').includes('embeddings'))
  assert.ok(idsFor('language').includes('language-defaults'))
})

test('every result carries a resolvable path and a non-key title', () => {
  for (const result of searchAdmin('api key', t)) {
    assert.ok(result.path.startsWith('/admin'), `bad path: ${result.path}`)
    assert.ok(!result.title.includes('.'), `title looks like an unresolved key: ${result.title}`)
  }
})

/**
 * Jobs.
 *
 * Twenty-eight named, runnable things, none of which were indexed — so typing
 * one landed on a settings page that merely mentioned the word. Measured before
 * the fix: `sync movies` reached Libraries, `rebuild taste profiles` reached a
 * slider called "Borrowed from a taste twin", `studio logos` reached nothing at
 * all, and `full reset recommendations` put the destructive database purge on
 * top.
 */

test('every job is findable by the name the page shows', () => {
  for (const name of ALL_JOB_NAMES) {
    const displayName = JOB_DISPLAY_NAME_KEYS[name]
      ? t(JOB_DISPLAY_NAME_KEYS[name])
      : titleCaseJobName(name)
    const hits = searchAdmin(displayName, t)
    assert.ok(
      hits.some((r) => r.path.endsWith(`#${jobAnchor(name)}`)),
      `"${displayName}" does not find the ${name} job (got ${hits.map((r) => r.title).join(', ') || 'nothing'})`
    )
  }
})

test('a job name beats a settings page that merely mentions the word', () => {
  const cases: Array<[query: string, job: string]> = [
    ['sync movies', 'sync-movies'],
    ['rebuild taste profiles', 'rebuild-taste-profiles'],
    ['studio logos', 'enrich-studio-logos'],
    ['enrich metadata', 'enrich-metadata'],
    ['generate movie embeddings', 'generate-movie-embeddings'],
    ['discovery suggestions', 'generate-discovery-suggestions'],
  ]
  for (const [query, job] of cases) {
    const top = topFor(query)
    assert.equal(top?.path, `/admin/ops/jobs#${jobAnchor(job)}`, `"${query}" led to ${top?.title}`)
  }
})

test('a job can be found by its kebab id, as pasted from a log', () => {
  const top = topFor('generate-title-analysis')
  assert.equal(top?.path, `/admin/ops/jobs#${jobAnchor('generate-title-analysis')}`)
})

test('searching "jobs" reaches the page, not all twenty-eight cards', () => {
  // The entry answers this; flooding the palette with every card would make
  // the plural of the section name useless.
  const results = searchAdmin('jobs', t)
  assert.equal(results[0]?.entryId, 'jobs')
  assert.ok(results.every((r) => !r.path.includes('#job-')), 'a bare "jobs" listed job cards')
})

test('a full match hides the partial ones', () => {
  // `api key` returned fifteen rows and `tmdb key` seventeen: the useful ones,
  // then every card that happens to mention a key.
  const results = searchAdmin('purge database', t)
  assert.equal(results.length, 1)
  assert.equal(results[0].entryId, 'database')
})

test('the floor is relative, so a weak query still answers', () => {
  // If nothing matches more than one token, every one-token result survives —
  // the floor must never turn "few results" into "no results".
  assert.ok(searchAdmin('please show me the logs', t).length > 0)
})
