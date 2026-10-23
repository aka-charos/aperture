/**
 * The unified quality rating of every title, read from the library.
 *
 * The rule is unifiedRating.ts; this reads the columns it needs for a whole
 * table and caches the answer. The whole table, not the candidate pool,
 * because the rank-mapping takes percentiles over the library: a pool's
 * Metacritic range is not the library's.
 *
 * Cached per media type for QUALITY_RATINGS_TTL_MS. A recommendation job runs
 * both pipelines once per viewer, and the answer is one statement over every
 * title, so without the cache a twenty-viewer run reads the table forty times
 * for one answer. A rating that moved inside the window reaches the next run
 * instead of this one, which is harmless: ratings move weekly.
 *
 * Never throws. A failed read answers an empty map, and the scorer then falls
 * back to the media server's rating for every title -- the behaviour before
 * the unified rating existed -- rather than failing a run that is otherwise
 * fine.
 */
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { computeUnifiedRatings, type UnifiedRatingMediaType } from './unifiedRating.js'

const logger = createChildLogger('quality-ratings')

export const QUALITY_RATINGS_TTL_MS = 10 * 60 * 1000

interface CacheEntry {
  at: number
  ratings: Promise<Map<string, number | null>>
}

const cache = new Map<UnifiedRatingMediaType, CacheEntry>()

interface RatingRow {
  id: string
  imdb: number | null
  community: number | null
  tmdb: number | null
  rt: number | null
  metacritic: number | null
}

async function readRatings(mediaType: UnifiedRatingMediaType): Promise<Map<string, number | null>> {
  const table = mediaType === 'movie' ? 'movies' : 'series'
  try {
    // NUMERIC arrives from pg as a string; float8 arrives as a number.
    const result = await query<RatingRow>(
      `SELECT id,
              imdb_rating::float8      AS imdb,
              community_rating::float8 AS community,
              tmdb_rating::float8      AS tmdb,
              rt_critic_score::float8  AS rt,
              metacritic_score::float8 AS metacritic
         FROM ${table}`
    )
    return computeUnifiedRatings(result.rows, mediaType)
  } catch (err) {
    logger.warn({ err, mediaType }, 'Could not read ratings for the unified rating; scoring falls back to the media server rating')
    // Not cached: the next run asks again rather than scoring on the fallback
    // for the rest of the window.
    cache.delete(mediaType)
    return new Map()
  }
}

/**
 * Every title's unified rating (0-10), or null for a title no source rates.
 * A title absent from the map (added since the cache was filled, or a failed
 * read) is the caller's to fall back on.
 */
export function getQualityRatings(mediaType: UnifiedRatingMediaType): Promise<Map<string, number | null>> {
  const now = Date.now()
  const entry = cache.get(mediaType)
  if (entry && now - entry.at < QUALITY_RATINGS_TTL_MS) return entry.ratings
  const ratings = readRatings(mediaType)
  cache.set(mediaType, { at: now, ratings })
  return ratings
}
