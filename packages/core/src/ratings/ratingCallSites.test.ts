import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { sourceFiles, stripComments } from '../testing/sourceTree.js'

/**
 * Every rating the recommender scores goes through scoringRating, i.e. the
 * unified rating (F-167). A call handing calculateRatingScore the media
 * server's rating directly compiles, passes every other test, and quietly puts
 * that scorer back on the number this replaced -- which is the regression
 * this scan exists to catch.
 */
const CORE_SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Where the function is defined, not called. */
const DEFINITION = ['recommender', 'shared', 'scoring.ts'].join(sep)

test('every calculateRatingScore call scores the unified rating', () => {
  const offenders: string[] = []
  let calls = 0
  for (const file of sourceFiles(CORE_SRC)) {
    const rel = relative(CORE_SRC, file)
    if (rel.endsWith('.test.ts') || rel === DEFINITION) continue
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const match of source.matchAll(/calculateRatingScore\(\s*([A-Za-z_$][\w$]*)?/g)) {
      calls++
      if (match[1] !== 'scoringRating') offenders.push(`${rel}: calculateRatingScore(${match[1] ?? '...'}`)
    }
  }
  assert.deepEqual(offenders, [])
  // Both scorers, movies and series. A scan that matched nothing would pass.
  assert.ok(calls >= 2, `expected the movie and series scorers, found ${calls} call(s)`)
})
