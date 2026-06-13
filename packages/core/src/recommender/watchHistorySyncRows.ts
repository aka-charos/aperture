export interface WatchHistorySyncRow {
  playCount: number
  lastPlayedAt: Date | null
  isFavorite: boolean
  played: boolean
  playbackPositionTicks: number | null
  runtimeTicks: number | null
}

/** Merge duplicate rows that map to the same internal movie/episode ID. */
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
    runtimeTicks: existing.runtimeTicks ?? incoming.runtimeTicks,
  }
}

function pickLatestTimestamp(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}
