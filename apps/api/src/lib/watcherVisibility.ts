/**
 * Who may be NAMED in a title's watch counters.
 *
 * The community strip on a media page is anonymous — "6 Watched, 7 Plays" and
 * nothing about who. This module decides whether a given viewer gets names
 * alongside those numbers, and which ones.
 *
 * It is one function rather than an `isAdmin` check in each handler because the
 * rule grew exactly as planned: admins see everyone, a viewer with connections
 * sees themselves and their connections (docs/plans/social-connections.md), and
 * everyone else stays anonymous. `WatcherAudience` is a discriminated union for
 * that reason, and the pure decision lives in `watcherAudience.ts`. The client
 * is told which audience it got (`watcherAudience`, a decided value) and picks
 * its copy from that, never from `isAdmin`.
 *
 * The counters and the names are separate claims (F-110): the aggregate stays
 * the true total, and names are a subset of it whenever the audience is partial.
 *
 * The rule that makes this safe: names are attached SERVER-SIDE or not at all.
 * A viewer with no visibility gets no `watchers` key in the response — not an
 * empty array, not nulls — so the payload itself is the privacy boundary and no
 * client bug can reveal what it never received.
 *
 * An assumed session ("view as user") resolves correctly for free: the auth
 * plugin makes `request.user` the target and puts the real admin on
 * `request.impersonation`, so viewing as a non-admin shows the anonymous
 * version, which is what that mode is for.
 *
 * A WATCHER IS SOMEONE WHO PLAYED IT. Favoriting an unwatched title writes a
 * watch_history row, so the unfiltered version of these queries named people as
 * having watched films they had only bookmarked — a claim made about one person
 * to another, which is the worst place in the app for this particular mistake.
 * The favorite counts beside them are deliberately NOT filtered: they answer a
 * different question, and a viewer who bookmarked an episode should have it
 * counted whether or not they got to it.
 */
import { WATCH_HISTORY_PLAYED_SQL, displayNameSql, getVisibleConnectionIds } from '@aperture/core'
import { query } from './db.js'
import type { SessionUser } from '../plugins/auth.js'
import { resolveWatcherAudience, type WatcherAudience } from './watcherAudience.js'

export { audienceLabel, resolveWatcherAudience, type WatcherAudience } from './watcherAudience.js'

export interface WatcherEntry {
  userId: string
  name: string
  /** Plays for a movie; episode plays for a series. */
  playCount: number
  /** Episodes of this series the user has played. Absent for a movie. */
  episodesWatched?: number
  lastWatched: string | null
  favorite: boolean
}

/**
 * The audience for this viewer. An admin's is decided without a query (it is
 * everyone); anyone else's needs their visible connections.
 */
export async function watcherAudienceFor(viewer: SessionUser): Promise<WatcherAudience> {
  const connected = viewer.isAdmin ? [] : await getVisibleConnectionIds(viewer.id)
  return resolveWatcherAudience(viewer, connected)
}

/**
 * `display_name` is what the media server shows; `username` is the login. Fall
 * back rather than showing a blank row — an Emby user imported without a
 * display name is common. Core's `displayNameSql`, so a person is called the
 * same thing here as in their connections' dialogs and sliders.
 */
const NAME_SQL = displayNameSql('u')

/** Restricts a watcher query to the audience. Returns null when nobody may be named. */
function audienceClause(
  audience: WatcherAudience,
  params: unknown[]
): string | null {
  if (audience.kind === 'none') return null
  if (audience.kind === 'all') return ''
  if (audience.userIds.length === 0) return null
  params.push(audience.userIds)
  return ` AND wh.user_id = ANY($${params.length}::uuid[])`
}

export async function fetchMovieWatchers(
  movieId: string,
  audience: WatcherAudience
): Promise<WatcherEntry[] | undefined> {
  const params: unknown[] = [movieId]
  const clause = audienceClause(audience, params)
  if (clause === null) return undefined

  const result = await query<{
    user_id: string
    name: string
    play_count: number
    last_played_at: Date | null
    is_favorite: boolean
  }>(
    `SELECT wh.user_id,
            ${NAME_SQL} AS name,
            wh.play_count,
            wh.last_played_at,
            wh.is_favorite
     FROM watch_history wh
     JOIN users u ON u.id = wh.user_id
     WHERE wh.movie_id = $1 AND wh.media_type = 'movie'
       AND ${WATCH_HISTORY_PLAYED_SQL}${clause}
     ORDER BY wh.last_played_at DESC NULLS LAST, name ASC`,
    params
  )

  return result.rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    playCount: r.play_count ?? 0,
    lastWatched: r.last_played_at ? r.last_played_at.toISOString() : null,
    favorite: r.is_favorite === true,
  }))
}

/**
 * Series counterpart. `watch_history` holds series rows per EPISODE, so this
 * aggregates per user — and `favorite` means "has a favorited episode", the
 * same reading `favoritedEpisodes` uses in the stats above it.
 */
export async function fetchSeriesWatchers(
  seriesId: string,
  audience: WatcherAudience
): Promise<WatcherEntry[] | undefined> {
  const params: unknown[] = [seriesId]
  const clause = audienceClause(audience, params)
  if (clause === null) return undefined

  const result = await query<{
    user_id: string
    name: string
    episodes_watched: string
    total_plays: string
    last_played_at: Date | null
    favorites: string
  }>(
    // The played filter is a FILTER clause rather than a WHERE, so a viewer's
    // favorited episodes are still counted in full for them. Moving it up into
    // the WHERE would silently redefine `favorites` as "favorited episodes they
    // also played". The HAVING is what keeps this a list of watchers: someone
    // who only bookmarked an episode has no played rows and does not appear.
    `SELECT wh.user_id,
            ${NAME_SQL} AS name,
            COUNT(DISTINCT wh.episode_id) FILTER (WHERE ${WATCH_HISTORY_PLAYED_SQL})
              AS episodes_watched,
            COALESCE(SUM(wh.play_count) FILTER (WHERE ${WATCH_HISTORY_PLAYED_SQL}), 0)
              AS total_plays,
            MAX(wh.last_played_at) FILTER (WHERE ${WATCH_HISTORY_PLAYED_SQL}) AS last_played_at,
            COUNT(DISTINCT CASE WHEN wh.is_favorite THEN wh.episode_id END) AS favorites
     FROM watch_history wh
     JOIN episodes e ON e.id = wh.episode_id
     JOIN users u ON u.id = wh.user_id
     WHERE e.series_id = $1 AND wh.episode_id IS NOT NULL${clause}
     GROUP BY wh.user_id, u.display_name, u.username
     HAVING COUNT(*) FILTER (WHERE ${WATCH_HISTORY_PLAYED_SQL}) > 0
     ORDER BY MAX(wh.last_played_at) FILTER (WHERE ${WATCH_HISTORY_PLAYED_SQL})
              DESC NULLS LAST, name ASC`,
    params
  )

  return result.rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    // NUMERIC/COUNT arrive as text; Number(null) is 0, so parse explicitly.
    playCount: Number.parseInt(r.total_plays, 10) || 0,
    episodesWatched: Number.parseInt(r.episodes_watched, 10) || 0,
    lastWatched: r.last_played_at ? r.last_played_at.toISOString() : null,
    favorite: (Number.parseInt(r.favorites, 10) || 0) > 0,
  }))
}
