/**
 * Shows You Watch API Routes
 * 
 * Handles CRUD operations for user's watching series list
 * and library management.
 */

import type { FastifyPluginAsync } from 'fastify'
import { query, queryOne } from '../../lib/db.js'
import { requireAuth } from '../../plugins/auth.js'
import {
  getUpcomingEpisodes,
  refreshStaleTmdbTotals,
  reconcileWatchingFavoritesForUser,
  favoriteWatchingSeriesOnMediaServer,
  unfavoriteWatchingSeriesOnMediaServer,
} from '@aperture/core/watching'
import { watchingSchemas } from './schemas.js'

interface WatchingSeriesRow {
  series_id: string
  watching_id: string | null
  title: string
  year: number | null
  poster_url: string | null
  backdrop_url: string | null
  genres: string[]
  overview: string | null
  community_rating: number | null
  network: string | null
  status: string | null
  total_seasons: number | null
  total_episodes: number | null
  added_at: string | null
  tmdb_id: string | null
  tmdb_total_episodes: number | null
  tmdb_total_seasons: number | null
  tmdb_seasons: { season_number: number; episode_count: number; air_date: string | null }[] | null
  tmdb_status: string | null
  episodes_watched: string | null
  episodes_on_server: string
  last_played_at: string | null
  in_watchlist: boolean
  in_history: boolean
}

interface WatchingSeriesResponse {
  id: string
  seriesId: string
  title: string
  year: number | null
  posterUrl: string | null
  backdropUrl: string | null
  genres: string[]
  overview: string | null
  communityRating: number | null
  network: string | null
  status: string | null
  totalSeasons: number | null
  totalEpisodes: number | null
  addedAt: string | null
  inWatchlist: boolean
  inHistory: boolean
  episodesWatched: number
  episodesOnServer: number
  /** Episodes aired so far per TMDB (null when TMDB season data is not cached yet) */
  episodesAired: number | null
  /** Aired episodes not present on the media server */
  episodesMissing: number
  tmdbTotalEpisodes: number | null
  tmdbTotalSeasons: number | null
  /** Aired seasons (per TMDB) with zero episodes on the media server */
  missingSeasons: number[]
  lastPlayedAt: string | null
  upcomingEpisode: {
    seasonNumber: number
    episodeNumber: number
    title: string
    airDate: string
    source: 'emby' | 'tmdb'
  } | null
}

/**
 * Media-server series status is often stale (long-canceled shows still say
 * "Continuing"), so when TMDB status is cached it wins. TMDB values map onto
 * the media-server vocabulary the frontend already checks: anything not
 * ended/canceled counts as "Continuing".
 */
function effectiveSeriesStatus(
  mediaServerStatus: string | null,
  tmdbStatus: string | null
): string | null {
  if (!tmdbStatus) return mediaServerStatus
  if (tmdbStatus === 'Ended' || tmdbStatus === 'Canceled') return tmdbStatus
  return 'Continuing'
}

const watchingRoutes: FastifyPluginAsync = async (fastify) => {
  // Register schemas
  for (const [name, schema] of Object.entries(watchingSchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  /**
   * GET /api/watching
   * List the union of the user's watchlist (user_watching_series) and series
   * from their episode watch history, with progress + upcoming episode info.
   * Read-only union: history series are NEVER written to user_watching_series
   * (that table is synced to media-server favorites by the reconcile job).
   */
  fastify.get<{
    Reply: { series: WatchingSeriesResponse[]; total: number }
  }>('/api/watching', { preHandler: requireAuth, schema: { tags: ["watching"] } }, async (request, reply) => {
    const userId = request.user!.id

    const result = await query<WatchingSeriesRow>(
      `WITH hist AS (
         SELECT e.series_id,
                COUNT(DISTINCT e.id) AS episodes_watched,
                MAX(wh.last_played_at) AS last_played_at
         FROM watch_history wh
         JOIN episodes e ON e.id = wh.episode_id
         WHERE wh.user_id = $1 AND wh.episode_id IS NOT NULL
         GROUP BY e.series_id
       )
       SELECT s.id AS series_id, uws.id AS watching_id, uws.added_at,
              s.title, s.year, s.poster_url, s.backdrop_url, s.genres,
              s.overview, s.community_rating, s.network, s.status,
              s.total_seasons, s.total_episodes, s.tmdb_id,
              s.tmdb_total_episodes, s.tmdb_total_seasons, s.tmdb_seasons, s.tmdb_status,
              h.episodes_watched, h.last_played_at,
              (SELECT COUNT(*) FROM episodes e2 WHERE e2.series_id = s.id) AS episodes_on_server,
              (uws.id IS NOT NULL) AS in_watchlist,
              (h.series_id IS NOT NULL) AS in_history
       FROM series s
       LEFT JOIN user_watching_series uws ON uws.series_id = s.id AND uws.user_id = $1
       LEFT JOIN hist h ON h.series_id = s.id
       LEFT JOIN library_config lc ON lc.provider_library_id = s.provider_library_id
       WHERE uws.id IS NOT NULL
          OR (h.series_id IS NOT NULL
              AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true))
       ORDER BY h.last_played_at DESC NULLS LAST, uws.added_at DESC NULLS LAST`,
      [userId]
    )

    // Upcoming episodes: the Emby-side batch query covers the full union, but
    // the live TMDB fallback is limited to watchlist series and history series
    // that are still airing (ended shows can't have upcoming episodes).
    const seriesIds = result.rows.map((r) => r.series_id)
    const tmdbFallbackIds = new Set(
      result.rows
        .filter(
          (r) =>
            r.in_watchlist || effectiveSeriesStatus(r.status, r.tmdb_status) === 'Continuing'
        )
        .map((r) => r.series_id)
    )
    const upcomingEpisodes = await getUpcomingEpisodes(seriesIds, { tmdbFallbackIds })

    // Which seasons exist on the server per series — compared against TMDB's
    // per-season data to flag aired seasons missing from the library entirely.
    const serverSeasons = new Map<string, Set<number>>()
    if (seriesIds.length > 0) {
      const seasonRows = await query<{ series_id: string; season_number: number }>(
        `SELECT DISTINCT series_id, season_number FROM episodes WHERE series_id = ANY($1)`,
        [seriesIds]
      )
      for (const r of seasonRows.rows) {
        let set = serverSeasons.get(r.series_id)
        if (!set) {
          set = new Set()
          serverSeasons.set(r.series_id, set)
        }
        set.add(r.season_number)
      }
    }

    const today = new Date().toISOString().split('T')[0]

    const series: WatchingSeriesResponse[] = result.rows.map((row) => {
      const upcoming = upcomingEpisodes.get(row.series_id)
      const onServer = serverSeasons.get(row.series_id)
      // Regular seasons (per TMDB) that started airing. Specials (season 0)
      // and unaired/announced seasons are ignored.
      const airedSeasons = (row.tmdb_seasons ?? []).filter(
        (s) =>
          s.season_number >= 1 &&
          s.episode_count > 0 &&
          s.air_date !== null &&
          s.air_date <= today
      )
      const missingSeasons = airedSeasons
        .filter((s) => !onServer?.has(s.season_number))
        .map((s) => s.season_number)
        .sort((a, b) => a - b)
      // Aired episode count: full episode_count per started season, except
      // the season currently airing — there TMDB's episode_count includes
      // announced-but-unaired episodes, so cap at (next episode number - 1).
      let episodesAired: number | null = null
      if (airedSeasons.length > 0) {
        episodesAired = airedSeasons.reduce((sum, s) => {
          if (upcoming && upcoming.seasonNumber === s.season_number) {
            return sum + Math.min(s.episode_count, Math.max(0, upcoming.episodeNumber - 1))
          }
          return sum + s.episode_count
        }, 0)
      }
      const episodesOnServer = parseInt(row.episodes_on_server, 10) || 0
      const episodesMissing =
        episodesAired !== null ? Math.max(0, episodesAired - episodesOnServer) : 0
      return {
        id: row.watching_id ?? row.series_id,
        seriesId: row.series_id,
        title: row.title,
        year: row.year,
        posterUrl: row.poster_url,
        backdropUrl: row.backdrop_url,
        genres: row.genres || [],
        overview: row.overview,
        communityRating: row.community_rating,
        network: row.network,
        status: effectiveSeriesStatus(row.status, row.tmdb_status),
        totalSeasons: row.total_seasons,
        totalEpisodes: row.total_episodes,
        addedAt: row.added_at,
        inWatchlist: row.in_watchlist,
        inHistory: row.in_history,
        episodesWatched: row.episodes_watched ? parseInt(row.episodes_watched, 10) : 0,
        episodesOnServer,
        episodesAired,
        episodesMissing,
        tmdbTotalEpisodes: row.tmdb_total_episodes,
        tmdbTotalSeasons: row.tmdb_total_seasons,
        missingSeasons,
        lastPlayedAt: row.last_played_at,
        upcomingEpisode: upcoming ? {
          seasonNumber: upcoming.seasonNumber,
          episodeNumber: upcoming.episodeNumber,
          title: upcoming.title,
          airDate: upcoming.airDate,
          source: upcoming.source,
        } : null,
      }
    })

    // Refresh stale TMDB aired totals in the background (bounded per request);
    // never awaited so the response isn't TMDB-bound.
    void refreshStaleTmdbTotals(seriesIds).catch((err) => {
      fastify.log.warn({ err, userId }, 'TMDB totals refresh failed')
    })

    return reply.send({ series, total: series.length })
  })

  /**
   * GET /api/watching/ids
   * Get list of series IDs the user is watching (for quick UI checks)
   */
  fastify.get<{
    Reply: { seriesIds: string[] }
  }>('/api/watching/ids', { preHandler: requireAuth, schema: { tags: ["watching"] } }, async (request, reply) => {
    const userId = request.user!.id

    const result = await query<{ series_id: string }>(
      `SELECT series_id FROM user_watching_series WHERE user_id = $1`,
      [userId]
    )

    return reply.send({ seriesIds: result.rows.map((r) => r.series_id) })
  })

  /**
   * POST /api/watching/:seriesId
   * Add series to user's watching list
   */
  fastify.post<{
    Params: { seriesId: string }
    Reply: { success: boolean; message: string }
  }>('/api/watching/:seriesId', { preHandler: requireAuth, schema: { tags: ["watching"] } }, async (request, reply) => {
    const userId = request.user!.id
    const { seriesId } = request.params

    // Check if series exists
    const series = await queryOne<{ id: string; title: string }>(
      'SELECT id, title FROM series WHERE id = $1',
      [seriesId]
    )

    if (!series) {
      return reply.status(404).send({ success: false, message: 'Series not found' })
    }

    // Check if already watching
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM user_watching_series WHERE user_id = $1 AND series_id = $2',
      [userId, seriesId]
    )

    if (existing) {
      return reply.send({ success: true, message: 'Already in watching list' })
    }

    // Add to watching list
    await query(
      'INSERT INTO user_watching_series (user_id, series_id) VALUES ($1, $2)',
      [userId, seriesId]
    )

    fastify.log.info({ userId, seriesId, title: series.title }, 'Added series to watching list')

    try {
      await favoriteWatchingSeriesOnMediaServer(request.user!.providerUserId, seriesId)
    } catch (err) {
      fastify.log.warn({ err, userId, seriesId }, 'Failed to favorite series on media server (watching saved)')
    }

    return reply.send({ success: true, message: `Added "${series.title}" to watching list` })
  })

  /**
   * DELETE /api/watching/:seriesId
   * Remove series from user's watching list
   */
  fastify.delete<{
    Params: { seriesId: string }
    Reply: { success: boolean; message: string }
  }>('/api/watching/:seriesId', { preHandler: requireAuth, schema: { tags: ["watching"] } }, async (request, reply) => {
    const userId = request.user!.id
    const { seriesId } = request.params

    const result = await query(
      'DELETE FROM user_watching_series WHERE user_id = $1 AND series_id = $2',
      [userId, seriesId]
    )

    if (result.rowCount === 0) {
      return reply.status(404).send({ success: false, message: 'Series not in watching list' })
    }

    fastify.log.info({ userId, seriesId }, 'Removed series from watching list')

    try {
      await unfavoriteWatchingSeriesOnMediaServer(request.user!.providerUserId, seriesId)
    } catch (err) {
      fastify.log.warn({ err, userId, seriesId }, 'Failed to unfavorite series on media server (watching removed)')
    }

    return reply.send({ success: true, message: 'Removed from watching list' })
  })

  /**
   * POST /api/watching/refresh
   * Reconcile Shows You Watch with media server series favorites (Emby/Jellyfin)
   */
  fastify.post<{
    Reply: {
      success: boolean
      message: string
      skipped: boolean
      reason?: string
      pushedToServer: number
      removedFromDb: number
      pulledIntoDb: number
      pushErrors: number
    }
  }>('/api/watching/refresh', { preHandler: requireAuth, schema: { tags: ["watching"] } }, async (request, reply) => {
    const user = request.user!

    try {
      const result = await reconcileWatchingFavoritesForUser(user.id, user.providerUserId)

      if (result.skipped) {
        const msg =
          result.reason === 'watching_disabled'
            ? 'Shows You Watch is disabled'
            : result.reason === 'no_api_key'
              ? 'Media server API key not configured'
              : result.reason === 'no_provider_user_id'
                ? 'Account is not linked to the media server'
                : result.reason === 'list_favorites_failed'
                  ? 'Could not read favorites from media server'
                  : 'Sync skipped'
        return reply.send({
          success: true,
          message: msg,
          skipped: true,
          reason: result.reason,
          pushedToServer: 0,
          removedFromDb: 0,
          pulledIntoDb: 0,
          pushErrors: 0,
        })
      }

      return reply.send({
        success: true,
        message: 'Shows You Watch synced with media server favorites',
        skipped: false,
        pushedToServer: result.pushedToServer,
        removedFromDb: result.removedFromDb,
        pulledIntoDb: result.pulledIntoDb,
        pushErrors: result.pushErrors,
      })
    } catch (err) {
      fastify.log.error({ err, userId: user.id }, 'Failed to sync watching favorites')
      return reply.status(500).send({
        success: false,
        message: 'Failed to sync with media server',
        skipped: false,
        pushedToServer: 0,
        removedFromDb: 0,
        pulledIntoDb: 0,
        pushErrors: 0,
      })
    }
  })

  /**
   * GET /api/watching/check/:seriesId
   * Check if a specific series is in user's watching list
   */
  fastify.get<{
    Params: { seriesId: string }
    Reply: { isWatching: boolean }
  }>('/api/watching/check/:seriesId', { preHandler: requireAuth, schema: { tags: ["watching"] } }, async (request, reply) => {
    const userId = request.user!.id
    const { seriesId } = request.params

    const result = await queryOne<{ id: string }>(
      'SELECT id FROM user_watching_series WHERE user_id = $1 AND series_id = $2',
      [userId, seriesId]
    )

    return reply.send({ isWatching: !!result })
  })
}

export default watchingRoutes
