/**
 * "Has this viewer finished this title?" — the question a poster badge asks.
 *
 * Deliberately a fourth predicate rather than a reuse of the three in
 * `recommender/watchedExclusion.ts`, and the difference is the whole point:
 *
 * - WATCH_HISTORY_TASTE_SQL       = what shaped your taste (played OR favorite)
 * - WATCH_HISTORY_EXCLUDABLE_SQL  = have you seen it (played OR >=5% progress)
 * - getExpandedFavorited*Ids      = have you already found it
 * - here                          = have you FINISHED it
 *
 * A badge is a claim made to the viewer's face, so the two looser readings are
 * both wrong for it: a bookmark is not a watch, and a film abandoned six
 * minutes in must not come back wearing a tick. `played` is the media server's
 * own flag and is exactly what Emby draws its check from.
 *
 * A series is watched when every episode the library holds is played — the same
 * rule Emby applies, and the reason it is `series.total_episodes`' population
 * rather than TMDb's: someone who owns one season of five and watched it has
 * finished everything there is to finish here. A part-watched show gets no
 * badge; it is not a lesser tick, it is a different fact.
 */
import { query } from '../lib/db.js'

export interface WatchedItemIds {
  movieIds: string[]
  seriesIds: string[]
}

/**
 * Every movie and fully-watched series id for one viewer, in one round trip.
 *
 * Sized for a whole-library answer on purpose: the alternative is a watched
 * flag on each of the ten list endpoints that feed a poster grid, and ten
 * copies of this predicate is how they come to disagree. A heavy viewer here
 * is a few thousand ids.
 */
export async function getWatchedItemIdsForUser(userId: string): Promise<WatchedItemIds> {
  const [movies, series] = await Promise.all([
    query<{ id: string }>(
      `SELECT movie_id AS id
       FROM watch_history
       WHERE user_id = $1 AND media_type = 'movie' AND movie_id IS NOT NULL AND played = true`,
      [userId]
    ),
    // The IN (...) is not redundant with the HAVING: without it this aggregates
    // every episode row in the library to answer a question about the handful
    // of shows the viewer has actually touched.
    query<{ id: string }>(
      `SELECT e.series_id AS id
       FROM episodes e
       LEFT JOIN watch_history wh
         ON wh.episode_id = e.id AND wh.user_id = $1 AND wh.played = true
       WHERE e.series_id IN (
         SELECT DISTINCT e2.series_id
         FROM watch_history wh2
         JOIN episodes e2 ON e2.id = wh2.episode_id
         WHERE wh2.user_id = $1 AND wh2.played = true
       )
       GROUP BY e.series_id
       HAVING COUNT(*) FILTER (WHERE wh.episode_id IS NULL) = 0`,
      [userId]
    ),
  ])

  return {
    movieIds: movies.rows.map((r) => r.id),
    seriesIds: series.rows.map((r) => r.id),
  }
}
