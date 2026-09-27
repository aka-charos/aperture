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
// Direct, not through the barrel: a barrel import from inside core is a cycle.
import { WATCH_HISTORY_PLAYED_SQL } from '../recommender/watchedExclusion.js'

/**
 * SQL boolean: `user` has finished this movie — the badge's movie rule
 * (`played = true`), for callers asking about a handful of titles rather than
 * the whole library. `user` and `movieId` are SQL expressions (a placeholder
 * such as `'$1::uuid'`, or a column).
 *
 * THE SAME RULE as the movie half of `getWatchStatusForUser` below. It lives
 * beside it so the two cannot drift: the shared-with-me inbox drops a title
 * the recipient has finished, and a title that drops out of the inbox while
 * its poster shows no tick (or the reverse) is exactly the disagreement a
 * duplicated predicate produces. The `wh` alias is scoped to the subquery, so
 * it binds to this subquery's `watch_history` even when the caller also uses
 * `wh`.
 */
export function movieFinishedSql(user: string, movieId: string): string {
  return `EXISTS (SELECT 1 FROM watch_history wh
                   WHERE wh.user_id = ${user} AND wh.movie_id = ${movieId}
                     AND ${WATCH_HISTORY_PLAYED_SQL})`
}

/**
 * SQL boolean: `user` has played every non-special episode of this series, and
 * there is at least one — `getWatchStatusForUser`'s finished rule for a show
 * (a tick rather than an `8/24` pill). A show partway through is NOT finished.
 */
export function seriesFinishedSql(user: string, seriesId: string): string {
  return `(SELECT COUNT(*) > 0 AND COUNT(wh.episode_id) = COUNT(*)
             FROM episodes fe
             LEFT JOIN watch_history wh
               ON wh.episode_id = fe.id AND wh.user_id = ${user} AND ${WATCH_HISTORY_PLAYED_SQL}
            WHERE fe.series_id = ${seriesId} AND fe.season_number > 0)`
}

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
