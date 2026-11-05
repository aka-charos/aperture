/**
 * Series Taste Profile Functions
 *
 * Provides series-specific taste profile utilities including:
 * - User series ratings
 * - Disliked series detection (for the exclude setting)
 */

import { query } from '../../lib/db.js'
import { DISLIKED_SERIES_IDS_SQL } from '../ratingBands.js'

export interface UserSeriesRating {
  seriesId: string
  rating: number
}

/**
 * Get all user ratings for series
 */
export async function getUserSeriesRatings(userId: string): Promise<Map<string, number>> {
  const result = await query<{ series_id: string; rating: number }>(
    `SELECT series_id, rating FROM user_ratings WHERE user_id = $1 AND series_id IS NOT NULL`,
    [userId]
  )
  return new Map(result.rows.map((r) => [r.series_id, r.rating]))
}

/**
 * Get all series IDs that the user has rated poorly (1-3 stars = disliked)
 * This mirrors the movie implementation in movies/taste.ts
 */
export async function getDislikedSeriesIds(userId: string): Promise<Set<string>> {
  // Series rated 1-3, and any other library copy of them
  const result = await query<{ id: string }>(DISLIKED_SERIES_IDS_SQL, [userId])
  return new Set(result.rows.map((r) => r.id))
}

