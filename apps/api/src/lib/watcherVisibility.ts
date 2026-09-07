/**
 * Who may be NAMED in a title's watch counters.
 *
 * The community strip on a media page is anonymous — "6 Watched, 7 Plays" and
 * nothing about who. This module decides whether a given viewer gets names
 * alongside those numbers, and which ones.
 *
 * It is one function rather than an `isAdmin` check in each handler because the
 * rule is expected to grow: the planned shape is that friends can see each
 * other's activity while everyone else stays anonymous, which changes this
 * decision and nothing else. `WatcherAudience` is a discriminated union rather
 * than a boolean for the same reason — `users` is the branch that feature will
 * fill in, and having it here now means the handlers and the client are already
 * written against a *set* of visible people rather than a yes/no.
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
 */
import { query } from './db.js'
import type { SessionUser } from '../plugins/auth.js'

export type WatcherAudience =
  /** Every watcher may be named (admins). */
  | { kind: 'all' }
  /** Nobody may be named — the caller omits the field entirely. */
  | { kind: 'none' }
  /**
   * Only these users may be named. Unused today; this is the branch the
   * friends feature fills in, and it is declared now so callers already
   * handle a partial audience rather than a boolean.
   */
  | { kind: 'users'; userIds: string[] }

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

export function resolveWatcherAudience(viewer: SessionUser): WatcherAudience {
  return viewer.isAdmin ? { kind: 'all' } : { kind: 'none' }
}

/**
 * `display_name` is what the media server shows; `username` is the login. Fall
 * back rather than showing a blank row — an Emby user imported without a
 * display name is common.
 */
const NAME_SQL = `NULLIF(TRIM(COALESCE(u.display_name, '')), '') , u.username`

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
            COALESCE(${NAME_SQL}) AS name,
            wh.play_count,
            wh.last_played_at,
            wh.is_favorite
     FROM watch_history wh
     JOIN users u ON u.id = wh.user_id
     WHERE wh.movie_id = $1 AND wh.media_type = 'movie'${clause}
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
    `SELECT wh.user_id,
            COALESCE(${NAME_SQL}) AS name,
            COUNT(DISTINCT wh.episode_id) AS episodes_watched,
            COALESCE(SUM(wh.play_count), 0) AS total_plays,
            MAX(wh.last_played_at) AS last_played_at,
            COUNT(DISTINCT CASE WHEN wh.is_favorite THEN wh.episode_id END) AS favorites
     FROM watch_history wh
     JOIN episodes e ON e.id = wh.episode_id
     JOIN users u ON u.id = wh.user_id
     WHERE e.series_id = $1 AND wh.episode_id IS NOT NULL${clause}
     GROUP BY wh.user_id, u.display_name, u.username
     ORDER BY MAX(wh.last_played_at) DESC NULLS LAST, name ASC`,
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
