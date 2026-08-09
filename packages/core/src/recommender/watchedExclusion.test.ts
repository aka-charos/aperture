import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isExcludableWatchHistoryRow,
  IN_PROGRESS_EXCLUSION_THRESHOLD,
  WATCH_HISTORY_EXCLUDABLE_SQL,
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
