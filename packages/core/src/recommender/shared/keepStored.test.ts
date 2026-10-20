import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  keepStoredJsonArray,
  keepStoredText,
  keepStoredTextArray,
  keepStoredValue,
} from './keepStored.js'

test('each blank kind falls back to the stored column', () => {
  assert.equal(keepStoredValue('year', 'movies'), 'COALESCE(data.year, movies.year)')
  assert.equal(keepStoredText('overview', 'series'), "COALESCE(NULLIF(btrim(data.overview), ''), series.overview)")
  const genres = keepStoredTextArray('genres', 'movies')
  assert.match(genres, /jsonb_array_length\(data\.genres\) > 0/)
  assert.match(genres, /ELSE COALESCE\(movies\.genres, '\{\}'\)/)
  const actors = keepStoredJsonArray('actors', 'series')
  assert.match(actors, /THEN data\.actors/)
  assert.match(actors, /ELSE series\.actors/)
})

test('only plain column names are accepted', () => {
  assert.throws(() => keepStoredValue('year; DROP TABLE movies', 'movies'))
  assert.throws(() => keepStoredText('overview', 'movies m'))
})

// The rule is only as good as its coverage: every UPDATE in both syncs must
// keep the stored value for these columns, or a mid-scan item blanks them
// through the one statement that forgot.
const PROTECTED = {
  movies: ['year', 'overview', 'genres', 'content_rating', 'directors', 'actors', 'studios'],
  series: ['year', 'overview', 'genres', 'content_rating', 'directors', 'actors', 'studios'],
} as const

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

test('both UPDATE statements in each sync keep the stored descriptive fields', () => {
  const files = {
    movies: source('../movies/sync.ts'),
    series: source('../series/seriesBatch.ts'),
  }
  for (const [table, text] of Object.entries(files) as Array<[keyof typeof PROTECTED, string]>) {
    const updates = text.split(`UPDATE ${table} SET`).length - 1
    assert.equal(updates, 2, `${table}: expected two UPDATE statements`)
    for (const column of PROTECTED[table]) {
      const kept = text.split(new RegExp(`\\b${column} = \\$\\{keepStored\\w+\\('${column}', '${table}'\\)\\}`)).length - 1
      assert.equal(kept, updates, `${table}.${column} is not kept in every UPDATE`)
      assert.doesNotMatch(text, new RegExp(`^\\s*${column} = data\\.${column},`, 'm'), `${table}.${column} written raw`)
    }
  }
})
