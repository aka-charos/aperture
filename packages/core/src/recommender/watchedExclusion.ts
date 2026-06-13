import { query } from '../lib/db.js'

export const IN_PROGRESS_EXCLUSION_THRESHOLD = 0.05

export function isExcludableWatchHistoryRow(
  played: boolean,
  playbackPositionTicks: number | null | undefined,
  runtimeTicks: number | null | undefined
): boolean {
  if (played) return true
  if (!playbackPositionTicks || !runtimeTicks || runtimeTicks <= 0) return false
  return playbackPositionTicks / runtimeTicks >= IN_PROGRESS_EXCLUSION_THRESHOLD
}

/** SQL fragment referencing watch_history columns as `wh` */
export const WATCH_HISTORY_EXCLUDABLE_SQL = `(
  wh.played = true
  OR (
    wh.playback_position_ticks IS NOT NULL
    AND wh.playback_position_ticks > 0
    AND wh.runtime_ticks IS NOT NULL
    AND wh.runtime_ticks > 0
    AND (wh.playback_position_ticks::numeric / wh.runtime_ticks::numeric) >= ${IN_PROGRESS_EXCLUSION_THRESHOLD}
  )
)`

/** SQL fragment for taste-profile input: fully played or favorited only */
export const WATCH_HISTORY_TASTE_SQL = `(wh.played = true OR wh.is_favorite = true)`

/**
 * All movie IDs that should be treated as watched for a user, including duplicate
 * library copies that share the same TMDb/IMDb ID as a watched title.
 */
export async function getExpandedWatchedMovieIds(userId: string): Promise<Set<string>> {
  const result = await query<{ id: string }>(
    `SELECT DISTINCT m.id
     FROM movies m
     WHERE m.id IN (
       SELECT wh.movie_id FROM watch_history wh
       WHERE wh.user_id = $1 AND wh.media_type = 'movie' AND ${WATCH_HISTORY_EXCLUDABLE_SQL}
     )
     OR m.tmdb_id IN (
       SELECT DISTINCT m2.tmdb_id FROM watch_history wh
       JOIN movies m2 ON m2.id = wh.movie_id
       WHERE wh.user_id = $1 AND wh.media_type = 'movie' AND m2.tmdb_id IS NOT NULL
         AND ${WATCH_HISTORY_EXCLUDABLE_SQL}
     )
     OR m.imdb_id IN (
       SELECT DISTINCT m2.imdb_id FROM watch_history wh
       JOIN movies m2 ON m2.id = wh.movie_id
       WHERE wh.user_id = $1 AND wh.media_type = 'movie' AND m2.imdb_id IS NOT NULL
         AND ${WATCH_HISTORY_EXCLUDABLE_SQL}
     )`,
    [userId]
  )
  return new Set(result.rows.map((r) => r.id))
}

/**
 * All series IDs that should be treated as watched for a user, including duplicate
 * library copies that share the same TMDb/IMDb/TVDB ID as a watched show.
 */
export async function getExpandedWatchedSeriesIds(userId: string): Promise<Set<string>> {
  const result = await query<{ id: string }>(
    `SELECT DISTINCT s.id
     FROM series s
     WHERE s.id IN (
       SELECT DISTINCT e.series_id
       FROM watch_history wh
       JOIN episodes e ON e.id = wh.episode_id
       WHERE wh.user_id = $1 AND wh.media_type = 'episode' AND ${WATCH_HISTORY_EXCLUDABLE_SQL}
     )
     OR s.tmdb_id IN (
       SELECT DISTINCT s2.tmdb_id
       FROM watch_history wh
       JOIN episodes e ON e.id = wh.episode_id
       JOIN series s2 ON s2.id = e.series_id
       WHERE wh.user_id = $1 AND wh.media_type = 'episode' AND s2.tmdb_id IS NOT NULL
         AND ${WATCH_HISTORY_EXCLUDABLE_SQL}
     )
     OR s.imdb_id IN (
       SELECT DISTINCT s2.imdb_id
       FROM watch_history wh
       JOIN episodes e ON e.id = wh.episode_id
       JOIN series s2 ON s2.id = e.series_id
       WHERE wh.user_id = $1 AND wh.media_type = 'episode' AND s2.imdb_id IS NOT NULL
         AND ${WATCH_HISTORY_EXCLUDABLE_SQL}
     )
     OR s.tvdb_id IN (
       SELECT DISTINCT s2.tvdb_id
       FROM watch_history wh
       JOIN episodes e ON e.id = wh.episode_id
       JOIN series s2 ON s2.id = e.series_id
       WHERE wh.user_id = $1 AND wh.media_type = 'episode' AND s2.tvdb_id IS NOT NULL
         AND ${WATCH_HISTORY_EXCLUDABLE_SQL}
     )`,
    [userId]
  )
  return new Set(result.rows.map((r) => r.id))
}

export async function getUserIncludeWatched(userId: string): Promise<boolean> {
  const result = await query<{ include_watched: boolean }>(
    `SELECT COALESCE(include_watched, false) AS include_watched
     FROM user_preferences
     WHERE user_id = $1`,
    [userId]
  )
  return result.rows[0]?.include_watched ?? false
}

export function filterByWatchedIds<T extends { id: string }>(
  items: T[],
  watchedIds: Set<string>
): T[] {
  return items.filter((item) => !watchedIds.has(item.id))
}
