import type { WatchedEpisode, WatchedItem } from './types.js'

export function mergeWatchedItems(existing: WatchedItem, incoming: WatchedItem): WatchedItem {
  const existingPosition = existing.playbackPositionTicks ?? 0
  const incomingPosition = incoming.playbackPositionTicks ?? 0
  const position =
    Math.max(existingPosition, incomingPosition) > 0
      ? Math.max(existingPosition, incomingPosition)
      : undefined

  return {
    movieId: existing.movieId,
    playCount: Math.max(existing.playCount, incoming.playCount),
    isFavorite: existing.isFavorite || incoming.isFavorite,
    lastPlayedDate: pickLatestDate(existing.lastPlayedDate, incoming.lastPlayedDate),
    userRating: incoming.userRating ?? existing.userRating,
    tmdbId: incoming.tmdbId ?? existing.tmdbId,
    imdbId: incoming.imdbId ?? existing.imdbId,
    played: existing.played || incoming.played || false,
    playbackPositionTicks: position,
    runtimeTicks: existing.runtimeTicks ?? incoming.runtimeTicks,
  }
}

export function mergeWatchedEpisodes(
  existing: WatchedEpisode,
  incoming: WatchedEpisode
): WatchedEpisode {
  const existingPosition = existing.playbackPositionTicks ?? 0
  const incomingPosition = incoming.playbackPositionTicks ?? 0
  const position =
    Math.max(existingPosition, incomingPosition) > 0
      ? Math.max(existingPosition, incomingPosition)
      : undefined

  return {
    episodeId: existing.episodeId,
    seriesId: incoming.seriesId || existing.seriesId,
    seasonNumber: incoming.seasonNumber ?? existing.seasonNumber,
    episodeNumber: incoming.episodeNumber ?? existing.episodeNumber,
    playCount: Math.max(existing.playCount, incoming.playCount),
    isFavorite: existing.isFavorite || incoming.isFavorite,
    lastPlayedDate: pickLatestDate(existing.lastPlayedDate, incoming.lastPlayedDate),
    userRating: incoming.userRating ?? existing.userRating,
    tmdbId: incoming.tmdbId ?? existing.tmdbId,
    imdbId: incoming.imdbId ?? existing.imdbId,
    tvdbId: incoming.tvdbId ?? existing.tvdbId,
    played: existing.played || incoming.played || false,
    playbackPositionTicks: position,
    runtimeTicks: existing.runtimeTicks ?? incoming.runtimeTicks,
  }
}

function pickLatestDate(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return a.localeCompare(b) >= 0 ? a : b
}
