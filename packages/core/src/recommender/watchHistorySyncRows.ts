export interface WatchHistorySyncRow {
  playCount: number
  lastPlayedAt: Date | null
  isFavorite: boolean
  played: boolean
  playbackPositionTicks: number | null
  runtimeTicks: number | null
}

/**
 * Merge duplicate rows that map to the same internal movie/episode ID.
 *
 * Must not depend on which row arrives first: the sync's upsert only writes a
 * row that changed (watchHistorySyncUpdateSql), so a merge that answered
 * differently when the provider returned the same two items in another order
 * would read as viewing activity on every sync and keep the activity gate
 * regenerating that viewer. Every field is a max, an OR or a latest, all of
 * which commute.
 */
export function mergeWatchHistorySyncRow(
  existing: WatchHistorySyncRow,
  incoming: WatchHistorySyncRow
): WatchHistorySyncRow {
  const existingPos = existing.playbackPositionTicks ?? 0
  const incomingPos = incoming.playbackPositionTicks ?? 0
  const maxPos = Math.max(existingPos, incomingPos)

  return {
    playCount: Math.max(existing.playCount, incoming.playCount),
    lastPlayedAt: pickLatestTimestamp(existing.lastPlayedAt, incoming.lastPlayedAt),
    isFavorite: existing.isFavorite || incoming.isFavorite,
    played: existing.played || incoming.played,
    playbackPositionTicks: maxPos > 0 ? maxPos : null,
    runtimeTicks: pickLargerTicks(existing.runtimeTicks, incoming.runtimeTicks),
  }
}

/**
 * The longer of two runtimes. Was the first non-null, which made the merge
 * depend on arrival order whenever two copies of one title (two libraries,
 * two cuts) report different runtimes. The longer one also keeps the progress
 * share computed against it conservative rather than overstated.
 */
function pickLargerTicks(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  // Compared as numbers: a runtime read back from a BIGINT column arrives as a string.
  return Number(a) >= Number(b) ? a : b
}

function pickLatestTimestamp(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

/**
 * The columns the media-server sync owns on a watch_history row, in the order
 * both upserts insert them.
 *
 * Every one of them counts as activity, including `playback_position_ticks`:
 * the position only moves when the viewer plays the title, and crossing 5% is
 * what moves a title into WATCH_HISTORY_EXCLUDABLE_SQL — so a drifting
 * position can change which candidates exist, and the activity gate must see
 * it. `runtime_ticks` moves only when the server reports a different runtime,
 * which is rare and is a real change to the progress figure built from it.
 */
export const WATCH_HISTORY_SYNC_COLUMNS = [
  'play_count',
  'last_played_at',
  'is_favorite',
  'played',
  'playback_position_ticks',
  'runtime_ticks',
] as const

/**
 * The `DO UPDATE` half of both sync upserts: the SET list, and a WHERE that
 * skips the update entirely when nothing the server reported has changed.
 *
 * The WHERE is the point. The sync runs in full mode on every pass (the jobs
 * and step 0 of both recommendation pipelines), so without it every row the
 * viewer has was rewritten every few hours, and `trigger_watch_history_updated_at`
 * (0008, BEFORE UPDATE) stamped `updated_at` on each one. The activity gate
 * reads `MAX(watch_history.updated_at)` as its watch-history signal, so it was
 * always newer than the last run and the gate never skipped anyone with any
 * history. A WHERE on `DO UPDATE` suppresses the UPDATE itself, which is the
 * only thing that stops a BEFORE UPDATE trigger; setting `updated_at` to its
 * old value would not, since the trigger overwrites it.
 *
 * Built from WATCH_HISTORY_SYNC_COLUMNS so the SET list and the comparison
 * cannot drift apart: a column written but not compared would be updated only
 * when some other column happened to change. `IS DISTINCT FROM` because the
 * tick columns and `last_played_at` are genuinely NULL on many rows, and `<>`
 * yields NULL (read by a WHERE as false) whenever either side is NULL: a
 * change to or from NULL, such as a first play or a cleared position, would be
 * skipped.
 */
export function watchHistorySyncUpdateSql(): string {
  const set = WATCH_HISTORY_SYNC_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(',\n         ')
  const stored = WATCH_HISTORY_SYNC_COLUMNS.map((c) => `watch_history.${c}`).join(', ')
  const incoming = WATCH_HISTORY_SYNC_COLUMNS.map((c) => `EXCLUDED.${c}`).join(', ')
  return `${set},
         updated_at = NOW()
       WHERE (${stored}) IS DISTINCT FROM (${incoming})`
}
