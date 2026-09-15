/**
 * The film Watcher Identity: the stored text, and the stats its card shows.
 *
 * Writing it lives in tasteSynopsisStream.ts, shared with the TV identity -- the
 * two generators were copies of each other, which is how a fix reaches one and
 * not the other.
 */

import { queryOne } from './db.js'
import { WATCH_HISTORY_PLAYED_SQL } from '../recommender/watchedExclusion.js'
import { streamWatcherIdentity } from './tasteSynopsisStream.js'

export interface TasteSynopsis {
  synopsis: string
  updatedAt: Date
  stats: {
    totalWatched: number
    topGenres: string[]
    avgRating: number
    favoriteDecade: string | null
    recentFavorites: string[]
  }
}

/**
 * Write a new film identity, streaming it to the caller as it arrives, and
 * return the stats the card shows beside it.
 */
export async function* streamTasteSynopsis(
  userId: string
): AsyncGenerator<string, TasteSynopsis['stats'], void> {
  yield* streamWatcherIdentity(userId, 'movie')
  return getQuickStats(userId)
}

/**
 * Get the stored synopsis. Never generates on page load: recommendation runs
 * rewrite it when the taste profile or the prompt version moves
 * (tasteSynopsisRefresh.ts), and the Generate Identity button rewrites it on
 * request.
 */
export async function getTasteSynopsis(userId: string): Promise<TasteSynopsis> {
  const existing = await queryOne<{
    taste_synopsis: string | null
    taste_synopsis_updated_at: Date | null
  }>(
    `
    SELECT taste_synopsis, taste_synopsis_updated_at
    FROM user_preferences
    WHERE user_id = $1
  `,
    [userId]
  )

  // Get stats for display (always needed)
  const stats = await getQuickStats(userId)

  if (existing?.taste_synopsis) {
    return {
      synopsis: existing.taste_synopsis,
      updatedAt: existing.taste_synopsis_updated_at
        ? new Date(existing.taste_synopsis_updated_at)
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
 * The card's stats, in a single CTE query.
 *
 * PLAYED titles only: these are numbers shown to a person about their own
 * viewing, and a favourite they have not watched is not viewing (F-114). On a
 * live instance the looser predicate put 413 "watched" on a card for a viewer
 * who had played 238 (F-129).
 */
async function getQuickStats(userId: string): Promise<TasteSynopsis['stats']> {
  const result = await queryOne<{
    total_watched: string
    avg_rating: string | null
    top_genres: string[] | null
    favorite_decade: string | null
    recent_favorites: string[] | null
  }>(
    `
    WITH watched_movies AS (
      SELECT m.id, m.genres, m.community_rating, m.year, m.title,
             wh.is_favorite, wh.last_played_at
      FROM watch_history wh
      JOIN movies m ON m.id = wh.movie_id
      WHERE wh.user_id = $1 AND ${WATCH_HISTORY_PLAYED_SQL}
    ),
    stats AS (
      SELECT
        COUNT(DISTINCT id) as total_watched,
        AVG(community_rating) as avg_rating
      FROM watched_movies
    ),
    genres AS (
      SELECT unnest(genres) as genre, COUNT(*) as cnt
      FROM watched_movies
      GROUP BY 1
      ORDER BY cnt DESC
      LIMIT 5
    ),
    decades AS (
      SELECT (FLOOR(year / 10) * 10)::TEXT || 's' as decade, COUNT(*) as cnt
      FROM watched_movies
      WHERE year IS NOT NULL
      GROUP BY 1
      ORDER BY cnt DESC
      LIMIT 1
    ),
    favorites AS (
      SELECT title
      FROM watched_movies
      WHERE is_favorite = true OR community_rating >= 7
      ORDER BY last_played_at DESC NULLS LAST
      LIMIT 5
    )
    SELECT
      (SELECT total_watched FROM stats) as total_watched,
      (SELECT avg_rating FROM stats) as avg_rating,
      (SELECT ARRAY_AGG(genre) FROM genres) as top_genres,
      (SELECT decade FROM decades) as favorite_decade,
      (SELECT ARRAY_AGG(title) FROM favorites) as recent_favorites
  `,
    [userId]
  )

  return {
    totalWatched: Number(result?.total_watched || 0),
    topGenres: result?.top_genres || [],
    avgRating: Number(result?.avg_rating || 0),
    favoriteDecade: result?.favorite_decade || null,
    recentFavorites: result?.recent_favorites || [],
  }
}
