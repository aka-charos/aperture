/**
 * The TV Watcher Identity: the stored text, and the stats its card shows.
 *
 * Writing it lives in tasteSynopsisStream.ts, shared with the film identity.
 * This generator used to run four queries (genres, networks, decade, the fifteen
 * most-watched shows with completion) whose results never reached the model.
 */

import { queryOne } from './db.js'
import { WATCH_HISTORY_PLAYED_SQL } from '../recommender/watchedExclusion.js'
import { streamWatcherIdentity } from './tasteSynopsisStream.js'

export interface SeriesTasteSynopsis {
  synopsis: string
  updatedAt: Date
  stats: {
    totalSeriesStarted: number
    totalEpisodesWatched: number
    topGenres: string[]
    avgRating: number
    favoriteDecade: string | null
    favoriteNetworks: string[]
    recentFavorites: string[]
  }
}

/**
 * Write a new TV identity, streaming it to the caller as it arrives, and return
 * the stats the card shows beside it.
 */
export async function* streamSeriesTasteSynopsis(
  userId: string
): AsyncGenerator<string, SeriesTasteSynopsis['stats'], void> {
  yield* streamWatcherIdentity(userId, 'series')
  return getSeriesQuickStats(userId)
}

/**
 * Get the stored series synopsis. Never generates on page load: recommendation
 * runs rewrite it when the taste profile or the prompt version moves
 * (tasteSynopsisRefresh.ts), and the Generate Identity button rewrites it on
 * request.
 */
export async function getSeriesTasteSynopsis(userId: string): Promise<SeriesTasteSynopsis> {
  const existing = await queryOne<{
    series_taste_synopsis: string | null
    series_taste_synopsis_updated_at: Date | null
  }>(
    `
    SELECT series_taste_synopsis, series_taste_synopsis_updated_at
    FROM user_preferences
    WHERE user_id = $1
  `,
    [userId]
  )

  // Get stats for display (always needed)
  const stats = await getSeriesQuickStats(userId)

  if (existing?.series_taste_synopsis) {
    return {
      synopsis: existing.series_taste_synopsis,
      updatedAt: existing.series_taste_synopsis_updated_at
        ? new Date(existing.series_taste_synopsis_updated_at)
        : new Date(),
      stats,
    }
  }

  // No synopsis yet - return empty, let user click "Generate Identity"
  return {
    synopsis: '',
    updatedAt: new Date(),
    stats,
  }
}

/**
 * The card's stats, in a single CTE query. PLAYED episodes only, for the
 * reason getQuickStats gives on the film side.
 */
async function getSeriesQuickStats(userId: string): Promise<SeriesTasteSynopsis['stats']> {
  const result = await queryOne<{
    series_count: string
    episode_count: string
    avg_rating: string | null
    top_genres: string[] | null
    favorite_networks: string[] | null
    favorite_decade: string | null
    recent_favorites: string[] | null
  }>(
    `
    WITH watched_series AS (
      SELECT DISTINCT ON (s.id)
        s.id, s.title, s.genres, s.community_rating, s.year, s.network,
        wh.is_favorite
      FROM watch_history wh
      JOIN episodes e ON e.id = wh.episode_id
      JOIN series s ON s.id = e.series_id
      WHERE wh.user_id = $1 AND wh.media_type = 'episode'
        AND ${WATCH_HISTORY_PLAYED_SQL}
    ),
    episode_counts AS (
      SELECT COUNT(DISTINCT wh.episode_id) as episode_count
      FROM watch_history wh
      WHERE wh.user_id = $1 AND wh.media_type = 'episode'
        AND ${WATCH_HISTORY_PLAYED_SQL}
    ),
    stats AS (
      SELECT
        COUNT(*) as series_count,
        AVG(community_rating) as avg_rating
      FROM watched_series
    ),
    genres AS (
      SELECT unnest(genres) as genre, COUNT(*) as cnt
      FROM watched_series
      GROUP BY 1
      ORDER BY cnt DESC
      LIMIT 5
    ),
    networks AS (
      SELECT network, COUNT(*) as cnt
      FROM watched_series
      WHERE network IS NOT NULL
      GROUP BY 1
      ORDER BY cnt DESC
      LIMIT 3
    ),
    decades AS (
      SELECT (FLOOR(year / 10) * 10)::TEXT || 's' as decade, COUNT(*) as cnt
      FROM watched_series
      WHERE year IS NOT NULL
      GROUP BY 1
      ORDER BY cnt DESC
      LIMIT 1
    ),
    favorites AS (
      SELECT title
      FROM watched_series
      WHERE is_favorite = true OR community_rating >= 7
      ORDER BY title
      LIMIT 5
    )
    SELECT
      (SELECT series_count FROM stats) as series_count,
      (SELECT episode_count FROM episode_counts) as episode_count,
      (SELECT avg_rating FROM stats) as avg_rating,
      (SELECT ARRAY_AGG(genre) FROM genres) as top_genres,
      (SELECT ARRAY_AGG(network) FROM networks) as favorite_networks,
      (SELECT decade FROM decades) as favorite_decade,
      (SELECT ARRAY_AGG(title) FROM favorites) as recent_favorites
  `,
    [userId]
  )

  return {
    totalSeriesStarted: Number(result?.series_count || 0),
    totalEpisodesWatched: Number(result?.episode_count || 0),
    topGenres: result?.top_genres || [],
    avgRating: Number(result?.avg_rating || 0),
    favoriteDecade: result?.favorite_decade || null,
    favoriteNetworks: result?.favorite_networks || [],
    recentFavorites: result?.recent_favorites || [],
  }
}
