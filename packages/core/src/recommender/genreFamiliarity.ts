/**
 * Watched-genre counts over a user's whole history, for the novelty term.
 *
 * Sits here rather than inside either pipeline for the same reason
 * watchedExclusion.ts does: both movies and series need it, and the two
 * pipelines had drifted apart on exactly this question. Movies derived their
 * genre baseline from `watched.slice(0, 50)` on top of an already
 * recentWatchLimit-capped list, series used the full recentWatchLimit list with
 * no slice -- so raising movie_recent_watch_limit did nothing while raising the
 * series one did.
 *
 * Neither was right. `recentWatchLimit` exists to bound the *similarity* inputs
 * (its own settings description says "Number of recent watches to consider for
 * similarity"), and getWatchHistory orders by `is_favorite DESC, play_count
 * DESC, last_played_at DESC`, so the 50 items movies were using were a user's
 * favourites and rewatches -- 1.4% of a 3500-title history, and heavily
 * skewed. Genres someone had watched widely but never favourited registered as
 * never seen at all. The taste profile itself already reads the full history
 * (builder.ts's getMovieWatchHistory, no limit); novelty was the outlier.
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { WATCH_HISTORY_TASTE_SQL } from './watchedExclusion.js'

const logger = createChildLogger('recommender-genre-familiarity')

/**
 * `genre -> number of distinct titles the user has watched carrying it`, over
 * their entire history.
 *
 * One aggregate returning roughly as many rows as the library has genres (~20),
 * gated by the same WATCH_HISTORY_TASTE_SQL predicate that decides what counts
 * as taste evidence elsewhere. Counts titles rather than genre occurrences so
 * the result does not shift with how many genres each title happens to carry.
 *
 * Fails soft to an empty map: calculateGenreNoveltyScore reads that as "no
 * history" and returns a neutral 0.5 for every candidate, which is strictly
 * better than blocking a recommendation run over a diagnostic-grade input.
 */
export async function getWatchedGenreCounts(
  userId: string,
  mediaType: 'movie' | 'series'
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()

  try {
    // CROSS JOIN LATERAL rather than unnest() in the select list: the count has
    // to be DISTINCT per genre, which needs the unnested rows as a relation.
    const result =
      mediaType === 'movie'
        ? await query<{ genre: string; items: string }>(
            `SELECT g.genre, COUNT(DISTINCT wh.movie_id) AS items
               FROM watch_history wh
               JOIN movies m ON m.id = wh.movie_id
               CROSS JOIN LATERAL unnest(m.genres) AS g(genre)
              WHERE wh.user_id = $1
                AND wh.media_type = 'movie'
                AND ${WATCH_HISTORY_TASTE_SQL}
              GROUP BY g.genre`,
            [userId]
          )
        : await query<{ genre: string; items: string }>(
            `SELECT g.genre, COUNT(DISTINCT e.series_id) AS items
               FROM watch_history wh
               JOIN episodes e ON e.id = wh.episode_id
               JOIN series s ON s.id = e.series_id
               CROSS JOIN LATERAL unnest(s.genres) AS g(genre)
              WHERE wh.user_id = $1
                AND wh.media_type = 'episode'
                AND ${WATCH_HISTORY_TASTE_SQL}
              GROUP BY g.genre`,
            [userId]
          )

    for (const row of result.rows) {
      const items = parseInt(row.items, 10)
      if (row.genre && Number.isFinite(items) && items > 0) {
        counts.set(row.genre, items)
      }
    }
  } catch (err) {
    logger.warn(
      { err, userId, mediaType },
      'Failed to load watched genre counts, novelty will score neutral for this run'
    )
  }

  return counts
}
