import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareCounts, inputCountsSql, isMissingRunCountsColumn, outputCountsSql } from './gateCounts.js'
import { sourceFiles, stripComments } from '../testing/sourceTree.js'
import { decideRegeneration, type GateThresholds } from './activityGate.js'

/**
 * The activity gate's deletion check. Timestamps cannot see a deleted row, so
 * each run stores row counts and the gate regenerates when one moves. These pin
 * the comparison, what is counted, that every run writer records the counts,
 * and how the gate reads them.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const CORE_SRC = join(HERE, '..')
const NOW = new Date('2026-08-10T12:00:00Z')
const T: GateThresholds = { newCandidateThreshold: 12, maxRunAgeDays: 35 }
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)
const QUIET = {
  watch_history: daysAgo(120),
  ratings: daysAgo(140),
  taste_profile: daysAgo(100),
  preferences: daysAgo(150),
  config: daysAgo(160),
  new_candidate_count: 0,
}
const INPUTS = { watch_history: 240, ratings: 31, preferences: 1, custom_interests: 2 }
const OUTPUTS = { picks: 20, evidence: 60 }

test('compareCounts: identical snapshots are the same', () => {
  assert.deepEqual(compareCounts(INPUTS, { ...INPUTS }), { kind: 'same' })
})

test('compareCounts: a drop is a change, and names the count', () => {
  assert.deepEqual(compareCounts(INPUTS, { ...INPUTS, ratings: 30 }), {
    kind: 'changed',
    key: 'ratings',
    stored: 31,
    current: 30,
  })
})

test('compareCounts: a rise is a change too (safe direction)', () => {
  const result = compareCounts(INPUTS, { ...INPUTS, watch_history: 241 })
  assert.equal(result.kind, 'changed')
})

test('compareCounts: nothing stored, or nothing read, is unknown, never "same"', () => {
  assert.equal(compareCounts(null, INPUTS).kind, 'unknown')
  assert.equal(compareCounts(undefined, INPUTS).kind, 'unknown')
  assert.equal(compareCounts(INPUTS, null).kind, 'unknown')
})

test('compareCounts: a count added after the run was stored is skipped, not a change', () => {
  assert.deepEqual(compareCounts(INPUTS, { ...INPUTS, watching_series: 4 }), { kind: 'same' })
})

test('inputCountsSql: movies count movie rows, series count episode rows and series favourites', () => {
  const movie = inputCountsSql('movie', '$1')
  const series = inputCountsSql('series', '$1')
  assert.match(movie, /media_type = 'movie'/)
  assert.match(movie, /movie_id IS NOT NULL/)
  assert.doesNotMatch(movie, /watching_series/)
  assert.match(series, /media_type = 'episode'/)
  assert.match(series, /series_id IS NOT NULL/)
  assert.match(series, /'watching_series'/)
  assert.match(series, /media_type IN \('series', 'both'\)/)
  // Bound to the placeholder it was given, never to an inlined id.
  assert.ok(inputCountsSql('movie', '$7').includes('user_id = $7'))
})

test('outputCountsSql counts only the run\'s selected rows', () => {
  const sql = outputCountsSql('$4')
  assert.match(sql, /'picks'/)
  assert.match(sql, /'evidence'/)
  assert.equal(sql.match(/is_selected = true/g)?.length, 2)
  assert.equal(sql.match(/run_id = \$4/g)?.length, 2)
})

/** Statements writing a run row, found in comment-stripped source. */
function runWriters(source: string) {
  const code = stripComments(source)
  return {
    inserts: code.match(/INSERT INTO recommendation_runs\b/g)?.length ?? 0,
    insertsWithCounts: code.match(/\$\{inputCountsSql\(/g)?.length ?? 0,
    // A finalize is any UPDATE of a run that sets its status, whatever it is
    // set to (a parameter or a literal), looked for within the statement.
    finalizes: code.match(/UPDATE recommendation_runs\b[\s\S]{0,600}?\bstatus\s*=/g)?.length ?? 0,
    finalizesWithCounts: code.match(/output_counts = \$\{outputCountsSql\(/g)?.length ?? 0,
  }
}

test('every run row written in core records its counts', () => {
  // A creator that skips input_counts leaves every one of its runs reading as
  // "unknown" forever, and a finalize that skips output_counts does the same
  // for picks: the gate would regenerate those viewers on every run. That is
  // the safe direction, which is exactly why nothing else would notice.
  const offenders: string[] = []
  let creators = 0
  let finalizers = 0
  for (const file of sourceFiles(CORE_SRC)) {
    if (file.endsWith('.test.ts')) continue
    const rel = relative(CORE_SRC, file).split(sep).join('/')
    const w = runWriters(readFileSync(file, 'utf8'))
    creators += w.inserts
    finalizers += w.finalizes
    if (w.insertsWithCounts < w.inserts) offenders.push(`${rel}: ${w.inserts} creates, ${w.insertsWithCounts} with counts`)
    if (w.finalizesWithCounts < w.finalizes) offenders.push(`${rel}: ${w.finalizes} finalizes, ${w.finalizesWithCounts} with counts`)
  }
  assert.equal(creators, 2, 'the two run creators (movie, series)')
  assert.equal(finalizers, 2, 'the two finalize writers (movie, series)')
  assert.deepEqual(offenders, [])
})

test('the writer scan sees a literal-status finalize and ignores comments', () => {
  // The two shapes the first version of this scan missed.
  const literal = runWriters("await query(`UPDATE recommendation_runs SET status = 'completed' WHERE id = $1`)")
  assert.equal(literal.finalizes, 1)
  assert.equal(literal.finalizesWithCounts, 0)
  const commented = runWriters(
    [
      "// output_counts = ${outputCountsSql('$1')}",
      "/* ${inputCountsSql('movie', '$1')} */",
      '  -- INSERT INTO recommendation_runs SET status = 1',
    ].join('\n')
  )
  assert.deepEqual(commented, { inserts: 0, insertsWithCounts: 0, finalizes: 0, finalizesWithCounts: 0 })
})

test('a missing 0203 column is recognised, and nothing else is', () => {
  const missing = (message: string, code = '42703') => Object.assign(new Error(message), { code })
  assert.ok(isMissingRunCountsColumn(missing('column "input_counts" of relation "recommendation_runs" does not exist')))
  assert.ok(isMissingRunCountsColumn(missing('column "output_counts" of relation "recommendation_runs" does not exist')))
  // Another missing column must still fail the write, not silently drop the counts.
  assert.equal(isMissingRunCountsColumn(missing('column "rating_weight" of relation "recommendation_runs" does not exist')), false)
  // Same words, different fault.
  assert.equal(isMissingRunCountsColumn(missing('input_counts is broken', '23505')), false)
  assert.equal(isMissingRunCountsColumn(null), false)
  assert.equal(isMissingRunCountsColumn('42703 input_counts'), false)
})

test('gate: no counts passed means the count check does not run', () => {
  assert.equal(decideRegeneration(daysAgo(7), QUIET, T, NOW).reason, 'unchanged')
})

test('gate: unchanged counts still skip', () => {
  const decision = decideRegeneration(
    daysAgo(7),
    { ...QUIET, input_counts: INPUTS, current_input_counts: { ...INPUTS }, output_counts: OUTPUTS, current_output_counts: { ...OUTPUTS } },
    T,
    NOW
  )
  assert.equal(decision.regenerate, false)
  assert.equal(decision.reason, 'unchanged')
})

test('gate: a deleted input row regenerates even though every timestamp is quiet', () => {
  const decision = decideRegeneration(
    daysAgo(7),
    { ...QUIET, input_counts: INPUTS, current_input_counts: { ...INPUTS, watch_history: 239 }, output_counts: OUTPUTS, current_output_counts: OUTPUTS },
    T,
    NOW
  )
  assert.equal(decision.regenerate, true)
  assert.equal(decision.reason, 'input-counts')
  assert.deepEqual(decision.countChange, { key: 'watch_history', stored: 240, current: 239 })
})

test('gate: a pick removed with its title regenerates', () => {
  const decision = decideRegeneration(
    daysAgo(7),
    { ...QUIET, input_counts: INPUTS, current_input_counts: INPUTS, output_counts: OUTPUTS, current_output_counts: { ...OUTPUTS, picks: 19 } },
    T,
    NOW
  )
  assert.equal(decision.reason, 'output-counts')
  assert.equal(decision.countChange?.key, 'picks')
})

test('gate: a run from before the snapshots regenerates (cannot rule a deletion out)', () => {
  const decision = decideRegeneration(
    daysAgo(7),
    { ...QUIET, input_counts: null, current_input_counts: INPUTS, output_counts: null, current_output_counts: OUTPUTS },
    T,
    NOW
  )
  assert.equal(decision.regenerate, true)
  assert.equal(decision.reason, 'counts-unknown')
})

test('gate: the age valve still fires before any count is read', () => {
  const decision = decideRegeneration(daysAgo(T.maxRunAgeDays + 1), { ...QUIET, input_counts: null, current_input_counts: INPUTS }, T, NOW)
  assert.equal(decision.reason, 'max-age')
})

test('the post-deploy check script counts what the gate counts', () => {
  // scripts/check-activity-gate.sql was generated from these functions. A
  // count added or rescoped here without regenerating it would make the check
  // report "would skip" for a viewer the gate regenerates, or the reverse.
  const script = readFileSync(join(CORE_SRC, '..', '..', '..', 'scripts', 'check-activity-gate.sql'), 'utf8')
  assert.ok(script.includes(inputCountsSql('movie', 'r.user_id')), 'movie input counts match')
  assert.ok(script.includes(inputCountsSql('series', 'r.user_id')), 'series input counts match')
  assert.ok(script.includes(outputCountsSql('r.id')), 'output counts match')
})
