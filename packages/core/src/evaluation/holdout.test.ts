import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ABANDONED_THRESHOLD,
  DEFAULT_RELEVANCE_WEIGHTS,
  SKEPTICAL_RELEVANCE_WEIGHTS,
  gradeRelevance,
  qualifies,
  splitHoldout,
  type WatchRecord,
} from './holdout.js'

const day = (n: number) => new Date(2026, 0, n)

const record = (over: Partial<WatchRecord> & { itemId: string }): WatchRecord => ({
  lastPlayedAt: day(1),
  playCount: 1,
  isFavorite: false,
  progress: null,
  played: false,
  ...over,
})

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

test('a title bailed on is never an answer key', () => {
  // The whole objection to "watched" as a label: WATCH_HISTORY_EXCLUDABLE_SQL
  // counts >= 5% progress as seen, so four minutes of a film would otherwise
  // be a correct answer, and the metric would reward serving more like it.
  assert.equal(gradeRelevance(record({ itemId: 'a', progress: 0.02 })), 0)
  assert.equal(gradeRelevance(record({ itemId: 'a', progress: 0 })), 0)
  assert.equal(gradeRelevance(record({ itemId: 'a', progress: null })), 0)
})

test('a started-but-unfinished title counts for almost nothing', () => {
  const graded = gradeRelevance(record({ itemId: 'a', progress: 0.4 }))
  assert.equal(graded, DEFAULT_RELEVANCE_WEIGHTS.started)
  assert.ok(graded < DEFAULT_RELEVANCE_WEIGHTS.completed)
})

test('the 5% floor is the same one the exclusion SQL uses', () => {
  assert.equal(gradeRelevance(record({ itemId: 'a', progress: ABANDONED_THRESHOLD })), 0.1)
  assert.equal(gradeRelevance(record({ itemId: 'a', progress: ABANDONED_THRESHOLD - 0.001 })), 0)
})

test('a favourite that was never played grades as a bookmark, not a love', () => {
  // People use Emby favourites as a watchlist; this repo already documents it.
  const bookmark = gradeRelevance(record({ itemId: 'a', isFavorite: true, progress: null }))
  assert.equal(bookmark, DEFAULT_RELEVANCE_WEIGHTS.favoritedUnplayed)
  assert.ok(bookmark < DEFAULT_RELEVANCE_WEIGHTS.completed)
})

test('a rewatch is the strongest signal and outranks everything short of it', () => {
  const rewatch = gradeRelevance(record({ itemId: 'a', playCount: 3, progress: 0.2 }))
  assert.equal(rewatch, DEFAULT_RELEVANCE_WEIGHTS.rewatched)
  // Graded on its strongest signal, not on the last branch that matched: this
  // one only reached 20% on its most recent play.
  assert.ok(rewatch > DEFAULT_RELEVANCE_WEIGHTS.started)
})

test('finished and marked beats finished alone', () => {
  const both = gradeRelevance(record({ itemId: 'a', played: true, isFavorite: true }))
  const finished = gradeRelevance(record({ itemId: 'a', played: true }))
  assert.ok(both > finished)
  assert.equal(finished, DEFAULT_RELEVANCE_WEIGHTS.completed)
})

test('the played flag and 90% progress mean the same thing', () => {
  assert.equal(
    gradeRelevance(record({ itemId: 'a', played: true, progress: null })),
    gradeRelevance(record({ itemId: 'a', played: false, progress: 0.95 }))
  )
})

test('the skeptical weighting moves favourites and leaves rewatches alone', () => {
  const bookmark = record({ itemId: 'a', isFavorite: true, progress: null })
  const rewatch = record({ itemId: 'b', playCount: 4 })

  assert.ok(
    gradeRelevance(bookmark, SKEPTICAL_RELEVANCE_WEIGHTS) <
      gradeRelevance(bookmark, DEFAULT_RELEVANCE_WEIGHTS)
  )
  assert.equal(
    gradeRelevance(rewatch, SKEPTICAL_RELEVANCE_WEIGHTS),
    gradeRelevance(rewatch, DEFAULT_RELEVANCE_WEIGHTS)
  )
})

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

test('the holdout is a count per viewer, so a sparse viewer gets the same answers', () => {
  const heavy = Array.from({ length: 400 }, (_, i) =>
    record({ itemId: `h${i}`, lastPlayedAt: day(400 - i), played: true })
  )
  const sparse = Array.from({ length: 30 }, (_, i) =>
    record({ itemId: `s${i}`, lastPlayedAt: day(30 - i), played: true })
  )

  assert.equal(splitHoldout(heavy, 20).test.length, 20)
  assert.equal(splitHoldout(sparse, 20).test.length, 20)
})

test('the most recent engaged titles are the ones held out', () => {
  const history = [
    record({ itemId: 'old', lastPlayedAt: day(1), played: true }),
    record({ itemId: 'mid', lastPlayedAt: day(5), played: true }),
    record({ itemId: 'new', lastPlayedAt: day(9), played: true }),
  ]

  const split = splitHoldout(history, 1)
  assert.deepEqual(
    split.test.map((t) => t.itemId),
    ['new']
  )
  assert.deepEqual(
    split.train.map((t) => t.itemId),
    ['mid', 'old']
  )
})

test('a bailed-on title in the held-out window is neither trained on nor scored', () => {
  const history = [
    record({ itemId: 'bailed', lastPlayedAt: day(9), progress: 0.01 }),
    record({ itemId: 'finished', lastPlayedAt: day(8), played: true }),
    record({ itemId: 'older', lastPlayedAt: day(1), played: true }),
  ]

  const split = splitHoldout(history, 1)
  assert.deepEqual(
    split.test.map((t) => t.itemId),
    ['finished']
  )
  assert.deepEqual(split.ignored, ['bailed'])
  // It must not reach the fingerprint: it sits inside the held-out window, and
  // training on it would be the evaluation using what it is meant to hide.
  assert.ok(!split.train.some((t) => t.itemId === 'bailed'))
})

test('a viewer with too little engaged history is short, not silently padded', () => {
  const history = [
    record({ itemId: 'a', lastPlayedAt: day(3), played: true }),
    record({ itemId: 'b', lastPlayedAt: day(2), progress: 0.01 }),
  ]

  const split = splitHoldout(history, 20)
  assert.equal(split.test.length, 1)
  assert.equal(split.train.length, 0)
  assert.equal(qualifies(split), false, 'one answer must not qualify as a measurement')
})

test('a qualifying viewer needs both answers and something to build from', () => {
  const history = Array.from({ length: 40 }, (_, i) =>
    record({ itemId: `x${i}`, lastPlayedAt: day(40 - i), played: true })
  )
  assert.equal(qualifies(splitHoldout(history, 20)), true)
})

test('the split is deterministic when every timestamp ties', () => {
  const tied = Array.from({ length: 10 }, (_, i) =>
    record({ itemId: `t${i}`, lastPlayedAt: day(1), played: true })
  )
  const first = splitHoldout(tied, 3)
  const second = splitHoldout([...tied].reverse(), 3)
  assert.deepEqual(first.test, second.test)
})

test('nothing is held out when the size is zero', () => {
  const history = [record({ itemId: 'a', played: true })]
  const split = splitHoldout(history, 0)
  assert.equal(split.test.length, 0)
  assert.equal(split.train.length, 1)
})
