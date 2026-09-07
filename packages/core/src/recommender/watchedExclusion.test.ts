import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isExcludableWatchHistoryRow,
  IN_PROGRESS_EXCLUSION_THRESHOLD,
  WATCH_HISTORY_EXCLUDABLE_SQL,
  WATCH_HISTORY_PLAYED_SQL,
  WATCH_HISTORY_TASTE_SQL,
} from './watchedExclusion.js'

/**
 * Favoriting is not watching. Two predicates encode that, and they must stay
 * different: fold favorites into the excludable one and a title you bookmarked
 * silently starts counting as seen -- disappearing from Seerr discovery and
 * from watched-only filters -- with nothing in the UI to explain it.
 *
 * The ID queries themselves need a database, so what is pinned here is the
 * policy: which signal answers which question.
 */

// ============================================================================
// Watched means played, or far enough in to count
// ============================================================================

test('a played item is excludable', () => {
  assert.equal(isExcludableWatchHistoryRow(true, null, null), true)
})

test('an untouched item is not excludable', () => {
  assert.equal(isExcludableWatchHistoryRow(false, null, null), false)
  assert.equal(isExcludableWatchHistoryRow(false, 0, 1000), false)
})

test('progress past the threshold counts as watched, a trailing start does not', () => {
  const runtime = 10_000
  const justUnder = runtime * (IN_PROGRESS_EXCLUSION_THRESHOLD - 0.01)
  const atThreshold = runtime * IN_PROGRESS_EXCLUSION_THRESHOLD

  assert.equal(isExcludableWatchHistoryRow(false, justUnder, runtime), false)
  assert.equal(isExcludableWatchHistoryRow(false, atThreshold, runtime), true)
})

test('missing runtime cannot be turned into a fraction, so it is not excludable', () => {
  assert.equal(isExcludableWatchHistoryRow(false, 5000, null), false)
  assert.equal(isExcludableWatchHistoryRow(false, 5000, 0), false)
})

// ============================================================================
// The two predicates answer different questions
// ============================================================================

test('taste input counts favorites; the watched test does not', () => {
  assert.match(WATCH_HISTORY_TASTE_SQL, /is_favorite/)
  assert.doesNotMatch(
    WATCH_HISTORY_EXCLUDABLE_SQL,
    /is_favorite/,
    'a favorite must keep answering "no" to "have they seen it" -- discovery and ' +
      'the STRM safety net both ask through this predicate'
  )
})

test('both predicates still treat a played item the same way', () => {
  assert.match(WATCH_HISTORY_TASTE_SQL, /played = true/)
  assert.match(WATCH_HISTORY_EXCLUDABLE_SQL, /played = true/)
})

test('partial progress belongs only to the watched test', () => {
  // Taste is about what you chose; progress is about what you have consumed.
  assert.match(WATCH_HISTORY_EXCLUDABLE_SQL, /playback_position_ticks/)
  assert.doesNotMatch(WATCH_HISTORY_TASTE_SQL, /playback_position_ticks/)
})

// ============================================================================
// "Did you play it" is the strictest of the three, and the one every count uses
// ============================================================================

test('the played predicate admits nothing but a play', () => {
  // The point of this one is what it leaves out. A favorite is not a play, and
  // neither is six minutes of a film someone abandoned — both of those are true
  // of one of the predicates above, which is why counting through either of
  // them told people they had watched things they had not.
  assert.match(WATCH_HISTORY_PLAYED_SQL, /played = true/)
  assert.doesNotMatch(WATCH_HISTORY_PLAYED_SQL, /is_favorite/)
  assert.doesNotMatch(WATCH_HISTORY_PLAYED_SQL, /playback_position_ticks/)
  assert.doesNotMatch(WATCH_HISTORY_PLAYED_SQL, /play_count/)
})

test('all three predicates are safe to AND into a query', () => {
  // Every caller appends these after an existing condition, so an unparenthesised
  // `a OR b` would silently widen the whole WHERE clause instead of narrowing it.
  for (const sql of [
    WATCH_HISTORY_PLAYED_SQL,
    WATCH_HISTORY_TASTE_SQL,
    WATCH_HISTORY_EXCLUDABLE_SQL,
  ]) {
    assert.ok(sql.startsWith('('), `${sql} must be parenthesised`)
    assert.ok(sql.trimEnd().endsWith(')'), `${sql} must be parenthesised`)
  }
})

test('every column in every predicate is wh-qualified', () => {
  // These are interpolated into queries that write `FROM watch_history wh`, and
  // often beside a JOIN onto movies or episodes. An unqualified `played` would
  // resolve against whatever else is in scope, or fail at runtime — inside an
  // SQL string, which nothing typechecks.
  const COLUMNS = ['played', 'is_favorite', 'playback_position_ticks', 'runtime_ticks', 'play_count']

  for (const sql of [
    WATCH_HISTORY_PLAYED_SQL,
    WATCH_HISTORY_TASTE_SQL,
    WATCH_HISTORY_EXCLUDABLE_SQL,
  ]) {
    for (const column of COLUMNS) {
      const mentions = sql.match(new RegExp(`\\b${column}\\b`, 'g'))?.length ?? 0
      const qualified = sql.match(new RegExp(`\\bwh\\.${column}\\b`, 'g'))?.length ?? 0
      assert.equal(mentions, qualified, `every ${column} must be wh.${column} in: ${sql}`)
    }
  }
})
