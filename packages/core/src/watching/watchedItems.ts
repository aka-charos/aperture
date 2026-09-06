/**
 * "Has this viewer finished this title, and if not, how far in are they?" — the
 * question a poster badge asks.
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
 * A series answers with counts rather than a boolean, because a bare "watched"
 * flag cannot say anything about a show someone is midway through, and a bare
 * remaining count (Emby's badge) cannot distinguish 8 episodes left of 8 from 8
 * left of 200. The population is the library's own episodes, not TMDb's totals:
 * someone who owns one season of five and watched it has finished everything
 * there is to finish here, which is `completionMultiplier`'s rule too.
 *
 * **Season 0 is excluded from both halves.** The sync stores specials as real
 * rows (it skips only null-numbered extras), so counting them means a viewer
 * who finished all five seasons but never watched the three Christmas specials
 * is never ticked and sits at 60/63 forever with nothing on screen explaining
 * why. A show is its seasons. Excluding them can only ever make a show easier
 * to complete, never harder.
 */
import { query } from '../lib/db.js'

/** Episode counts for one series, specials excluded. `total` is always > 0. */
export interface SeriesWatchProgress {
  id: string
  watched: number
  total: number
}

export interface WatchStatusForUser {
  movieIds: string[]
  /** Only shows with at least one played episode: a badge means "you are in this one". */
  series: SeriesWatchProgress[]
}

export async function getWatchStatusForUser(userId: string): Promise<WatchStatusForUser> {
  const [movies, series] = await Promise.all([
    query<{ id: string }>(
      `SELECT movie_id AS id
       FROM watch_history
       WHERE user_id = $1 AND media_type = 'movie' AND movie_id IS NOT NULL AND played = true`,
      [userId]
    ),
    // The IN (...) is not redundant with the aggregate: without it this walks
    // every episode row in the library to answer a question about the handful of
    // shows the viewer has touched. It is also what makes the result
    // started-shows-only — an untouched series is absent rather than 0/24, so a
    // badge on a poster always means the viewer is partway through.
    query<{ id: string; watched: string; total: string }>(
      `SELECT e.series_id AS id,
              COUNT(*) FILTER (WHERE wh.episode_id IS NOT NULL) AS watched,
              COUNT(*) AS total
       FROM episodes e
       LEFT JOIN watch_history wh
         ON wh.episode_id = e.id AND wh.user_id = $1 AND wh.played = true
       WHERE e.season_number > 0
         AND e.series_id IN (
           SELECT DISTINCT e2.series_id
           FROM watch_history wh2
           JOIN episodes e2 ON e2.id = wh2.episode_id
           WHERE wh2.user_id = $1 AND wh2.played = true AND e2.season_number > 0
         )
       GROUP BY e.series_id`,
      [userId]
    ),
  ])

  return {
    movieIds: movies.rows.map((r) => r.id),
    // COUNT comes back as a string like every other pg numeric, and Number(null)
    // is 0 rather than NaN, so these are parsed explicitly rather than trusted.
    series: series.rows.map((r) => ({
      id: r.id,
      watched: Number.parseInt(r.watched, 10),
      total: Number.parseInt(r.total, 10),
    })),
  }
}
