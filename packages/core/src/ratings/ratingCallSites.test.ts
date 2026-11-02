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

/**
 * Whether a call's argument is the unified rating: scoringRating(...) itself,
 * or a name (`scoredRating`, `candidate.scoredRating`) the same file assigns
 * straight from scoringRating(. The scorers keep the rating as well as the
 * score (recommendation_candidates.scored_rating, 0216), so they hold it in a
 * name first; anything else assigned to that name is still an offender.
 */
function fedByScoringRating(source: string, argument: string | undefined): boolean {
  if (argument === 'scoringRating') return true
  if (!argument) return false
  const name = argument.replace(/[.$]/g, '\\$&')
  return new RegExp(`(?:^|[^\\w$.])${name}\\s*=\\s*scoringRating\\(`).test(source)
}

test('every calculateRatingScore call scores the unified rating', () => {
  const offenders: string[] = []
  let calls = 0
  for (const file of sourceFiles(CORE_SRC)) {
    const rel = relative(CORE_SRC, file)
    if (rel.endsWith('.test.ts') || rel === DEFINITION) continue
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const match of source.matchAll(/calculateRatingScore\(\s*([A-Za-z_$][\w$.]*)?/g)) {
      calls++
      if (!fedByScoringRating(source, match[1])) offenders.push(`${rel}: calculateRatingScore(${match[1] ?? '...'}`)
    }
  }
  assert.deepEqual(offenders, [])
  // Both scorers, movies and series. A scan that matched nothing would pass.
  assert.ok(calls >= 2, `expected the movie and series scorers, found ${calls} call(s)`)
})
