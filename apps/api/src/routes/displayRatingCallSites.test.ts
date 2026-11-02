/**
 * Every route that shows, filters or sorts by a title's rating reads the one
 * the app shows everywhere -- core `displayRatingSql`, the unified rating with
 * the media server's own as the fallback while a title is not computed (F-167)
 * -- or says, here, why it reads the raw `community_rating` column.
 *
 * A raw read is how a poster comes to show 9.3 above a title page showing 7.5
 * for the same film, and nothing typed can see it: the column exists and the
 * query runs. So this scans the SQL in every route file (the text inside
 * template literals, comments stripped) for `community_rating` not written as
 * `AS community_rating` -- the alias every switched query keeps so the response
 * shapes stay as they were.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROUTES = fileURLToPath(new URL('.', import.meta.url))

/**
 * Files that read the raw column on purpose, and why. A stale entry fails too,
 * since a renamed file would come back unchecked while this list read as
 * reviewed.
 */
const EXEMPT: Record<string, string> = {
  // The title page: the raw column is one INPUT to the headline, read through
  // lib/qualityRating.ts beside the stored pair.
  [['movies', 'handlers', 'detail.ts'].join(sep)]: 'the headline reads it through qualityRatingFields',
  [['series', 'handlers', 'detail.ts'].join(sep)]: 'the headline reads it through qualityRatingFields',
  // Episodes have no unified rating; the media server's is the only one.
  [['series', 'handlers', 'episodes.ts'].join(sep)]: 'episode rows: no unified rating exists',
  [['assistant', 'tools', 'episodes.ts'].join(sep)]: 'episode rows: no unified rating exists',
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) yield full
  }
}

/** The text of every template literal, comments removed first. */
function templateTexts(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/`([^`]*)`/g)].map((m) => m[1])
}

/** A `community_rating` in SQL that is not the alias of a switched read. */
const RAW = /(^|[^\w'"])((?:[A-Za-z_]+\.)?community_rating)\b/g

function rawReads(sql: string): string[] {
  const found: string[] = []
  for (const m of sql.matchAll(RAW)) {
    const at = (m.index ?? 0) + m[1].length
    if (/AS\s+$/i.test(sql.slice(Math.max(0, at - 8), at))) continue
    // `${row.community_rating}` is a JS value interpolated into text, not SQL.
    if (sql.slice(Math.max(0, at - 2), at) === '${') continue
    found.push(m[2])
  }
  return found
}

test('every route reads the shown rating, not the raw column', () => {
  const offenders: string[] = []
  let filesWithAlias = 0
  for (const file of sourceFiles(ROUTES)) {
    const rel = relative(ROUTES, file)
    const texts = templateTexts(readFileSync(file, 'utf8'))
    if (texts.some((t) => /AS community_rating/.test(t))) filesWithAlias++
    if (rel in EXEMPT) continue
    for (const text of texts) {
      for (const raw of rawReads(text)) offenders.push(`${rel}: ${raw}`)
    }
  }
  assert.deepEqual(offenders, [])
  // The scan must be reading SQL at all: the switched routes are many.
  assert.ok(filesWithAlias >= 15, `expected the switched routes, found ${filesWithAlias}`)
})

test('every exemption still names a file that reads the raw column', () => {
  for (const rel of Object.keys(EXEMPT)) {
    const texts = templateTexts(readFileSync(join(ROUTES, rel), 'utf8'))
    assert.ok(texts.some((t) => rawReads(t).length > 0), `${rel} no longer reads community_rating; drop its entry`)
  }
})
