/**
 * Rating must go through `UserRatingsProvider`, and nothing else may write to
 * `/api/ratings`.
 *
 * This exists because the convention failed the first time it mattered. The
 * media detail page carried its own `fetch` to the same endpoint — a second
 * implementation of one action, harmless for as long as rating did nothing but
 * save a number. The moment something was attached to rating (the "when did
 * you watch this?" prompt, which the provider raises from the POST response)
 * the two paths stopped agreeing: cards and carousels asked the question, and
 * the detail page — where people actually rate, standing in front of the
 * poster — silently did not. Nothing failed. The rating saved, the stars
 * filled in, and the feature was simply absent on the one screen that matters
 * most.
 *
 * Writing this test then found two more: the disliked-items list in user
 * settings had its own POST and DELETE, which had been quietly leaving the
 * shared ratings map stale since long before any of this.
 *
 * A source scan is the only thing that catches that class of bug, because
 * every other check passes — it typechecks, it lints, it runs, and the
 * duplicate is a perfectly ordinary `fetch` call.
 *
 * If a new surface needs to rate something, call `useUserRatings().setRating`.
 * If it needs behaviour the provider does not have, add it to the provider.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/**
 * The one module allowed to write to the ratings endpoints. It owns the shared
 * ratings map and hosts the follow-up prompt, so a caller going around it
 * loses both.
 */
const ALLOWED = ['hooks/UserRatingsProvider.tsx']

/**
 * `/not-watched` is the watch-date prompt's own dismissal, posted by the
 * dialog the provider renders. It carries no rating and touches no ratings
 * state, so it is not a second rating path.
 */
const ALLOWED_SUFFIXES = ['/not-watched']

/**
 * Only *writes* are the concern, and a read cannot be told from a write by its
 * URL — the detail page GETs the very path it used to POST to. The method sits
 * in the options object a line or two below, so the window reads forward from
 * the URL: long enough to clear a `headers` line, short enough not to reach an
 * unrelated call after it.
 */
const METHOD_WINDOW = 240
const WRITE_METHOD = /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/
const RATINGS_URL = /['"`]\/api\/ratings[^'"`]*/g

function findWrites(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(RATINGS_URL)) {
    const url = match[0].slice(1)
    if (ALLOWED_SUFFIXES.some((suffix) => url.endsWith(suffix))) continue
    if (!WRITE_METHOD.test(source.slice(match.index, match.index + METHOD_WINDOW))) continue
    found.push(url)
  }
  return found
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(full) && !full.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('rating call sites', () => {
  test('only the provider writes to /api/ratings', () => {
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/')
      if (ALLOWED.includes(rel)) continue
      for (const url of findWrites(readFileSync(file, 'utf8'))) {
        offenders.push(`${rel} -> ${url}`)
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'These write ratings directly instead of through useUserRatings().setRating, ' +
        'so the shared ratings map goes stale and anything attached to rating ' +
        'silently does not happen there:\n  ' +
        offenders.join('\n  ')
    )
  })

  test('the scan sees a write and ignores a read', () => {
    // A guard that cannot fail is decoration, and this one has two ways to be
    // useless: miss the violation, or flag every GET until someone mutes it.
    // Both samples are real shapes — the write is the line that was in
    // useMediaDetail.ts, the read is the one still there.
    const write = 'await fetch(`/api/ratings/movie/${id}`, {\n  method: ' + "'POST',\n})"
    const read = 'await fetch(`/api/ratings/movie/${id}`, { credentials: ' + "'include' })"

    assert.deepEqual(findWrites(write), ['/api/ratings/movie/${id}'], 'a POST must be caught')
    assert.deepEqual(findWrites(read), [], 'a GET must not be')
  })
})
