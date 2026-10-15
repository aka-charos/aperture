import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  mergeWatchHistorySyncRow,
  WATCH_HISTORY_SYNC_COLUMNS,
  watchHistorySyncUpdateSql,
  type WatchHistorySyncRow,
} from './watchHistorySyncRows.js'

/**
 * The activity gate reads MAX(watch_history.updated_at) as its watch-history
 * signal. Both syncs run in full mode on every pass, so the gate can only ever
 * skip anyone if an unchanged row is NOT updated: the BEFORE UPDATE trigger
 * stamps updated_at on any update. (Removals are a separate question, answered
 * by the row counts in gateCounts.ts.)
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..', '..')

test('the update writes every sync column and compares every one, in the same order', () => {
  const sql = watchHistorySyncUpdateSql()
  const [setPart, wherePart] = sql.split(/\bWHERE\b/)
  assert.ok(wherePart, 'the DO UPDATE must carry a WHERE, or every row is rewritten every sync')

  for (const column of WATCH_HISTORY_SYNC_COLUMNS) {
    assert.match(setPart, new RegExp(`\\b${column} = EXCLUDED\\.${column}\\b`), `SET writes ${column}`)
  }

  const tuple = (prefix: string) =>
    `(${WATCH_HISTORY_SYNC_COLUMNS.map((c) => `${prefix}.${c}`).join(', ')})`
  assert.ok(
    wherePart.includes(`${tuple('watch_history')} IS DISTINCT FROM ${tuple('EXCLUDED')}`),
    'WHERE compares the stored row against the incoming one, null-safely'
  )
})

test('the comparison is null-safe, never =', () => {
  // last_played_at, the tick columns and favourites-only rows carry NULLs.
  // With <>, NULL <> anything is NULL, which a WHERE reads as false, so a
  // change to or from NULL (a first play, a cleared position) would be
  // skipped. IS DISTINCT FROM is the only comparison that sees it.
  const where = watchHistorySyncUpdateSql().split(/\bWHERE\b/)[1]
  assert.match(where, /IS DISTINCT FROM/)
  assert.doesNotMatch(where, /<>|!=|\)\s*=\s*\(/)
})

test('playback position counts as activity', () => {
  // Crossing 5% moves a title into WATCH_HISTORY_EXCLUDABLE_SQL, which changes
  // the candidate set, so the gate has to see the position move.
  assert.ok(WATCH_HISTORY_SYNC_COLUMNS.includes('playback_position_ticks'))
})

test('both sync upserts use the shared update clause, not a hand-written one', () => {
  for (const file of [
    'packages/core/src/recommender/movies/sync.ts',
    'packages/core/src/recommender/series/watchHistorySync.ts',
  ]) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8')
    assert.match(source, /\$\{watchHistorySyncUpdateSql\(\)\}/, `${file} uses watchHistorySyncUpdateSql`)
    assert.doesNotMatch(
      source,
      /play_count\s*=\s*EXCLUDED\.play_count/,
      `${file} must not restate the SET list, which would drift from the WHERE`
    )
  }
})

test('merging duplicate rows does not depend on which arrives first', () => {
  // Two copies of one film (two libraries, two cuts) resolved to one row. If
  // the merge answered differently by order, a provider returning them the
  // other way round would read as a changed row, and the gate would keep the
  // viewer active on every sync.
  const theatrical: WatchHistorySyncRow = {
    playCount: 1,
    lastPlayedAt: new Date('2026-05-01T20:00:00Z'),
    isFavorite: false,
    played: true,
    playbackPositionTicks: null,
    runtimeTicks: 72_000_000_000,
  }
  const extended: WatchHistorySyncRow = {
    playCount: 0,
    lastPlayedAt: null,
    isFavorite: true,
    played: false,
    playbackPositionTicks: 30_000_000_000,
    runtimeTicks: 96_000_000_000,
  }
  assert.deepEqual(
    mergeWatchHistorySyncRow(theatrical, extended),
    mergeWatchHistorySyncRow(extended, theatrical)
  )
  assert.equal(mergeWatchHistorySyncRow(theatrical, extended).runtimeTicks, 96_000_000_000)
  // A runtime missing on one side still takes the other.
  const unknown = { ...extended, runtimeTicks: null }
  assert.equal(mergeWatchHistorySyncRow(unknown, theatrical).runtimeTicks, 72_000_000_000)
  assert.equal(mergeWatchHistorySyncRow(theatrical, unknown).runtimeTicks, 72_000_000_000)
})
