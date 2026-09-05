import type { FastifyInstance } from 'fastify'
import { query, queryOne } from '../../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../../plugins/auth.js'
import {
  getMediaServerProvider,
  getMediaServerApiKey,
  isWatchDateBand,
  resolveWatchDate,
} from '@aperture/core'
import { requireSelfOrAdmin } from './shared.js'

async function canManageWatchHistory(userId: string, currentUser: SessionUser): Promise<boolean> {
  if (currentUser.isAdmin) return true

  const user = await queryOne<{ can_manage_watch_history: boolean }>(
    `SELECT can_manage_watch_history FROM users WHERE id = $1`,
    [userId]
  )
  return user?.can_manage_watch_history ?? false
}

export function registerWatchHistoryManagementHandlers(fastify: FastifyInstance) {
  /**
   * POST /api/users/:id/watch-history/movies/:movieId
   * Mark a movie as watched (marks played in Emby and records in Aperture)
   *
   * An optional `band` backdates the play to a coarse period the viewer chose
   * ("last month", "longer ago") rather than now. A bodyless request keeps the
   * original behaviour exactly — that is the Mark Watched button, which means
   * "I have just watched this".
   */
  fastify.post<{
    Params: { id: string; movieId: string }
    Body?: { band?: string }
  }>(
    '/api/users/:id/watch-history/movies/:movieId',
    { preHandler: requireAuth, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id, movieId } = request.params
      const currentUser = request.user as SessionUser

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      if (!(await canManageWatchHistory(id, currentUser))) {
        return reply.status(403).send({ error: 'Watch history management is not enabled for this user' })
      }

      try {
        const movie = await queryOne<{ provider_item_id: string; premiere_date: Date | null }>(
          `SELECT provider_item_id, premiere_date FROM movies WHERE id = $1`,
          [movieId]
        )
        if (!movie) {
          return reply.status(404).send({ error: 'Movie not found' })
        }

        // A band the viewer could not have meant is refused rather than
        // rounded to something plausible: `resolveWatchDate` returns null when
        // the band falls entirely before the film's release, and inventing a
        // date there would put a watch before the thing existed.
        const band = request.body?.band
        let playedAt: Date | undefined
        if (band !== undefined) {
          if (!isWatchDateBand(band)) {
            return reply.status(400).send({ error: 'Unknown watch date band' })
          }
          const resolved = resolveWatchDate(band, new Date(), movie.premiere_date ?? null)
          if (!resolved) {
            return reply
              .status(400)
              .send({ error: 'That period is before the title was released' })
          }
          playedAt = resolved
        }

        const user = await queryOne<{ provider_user_id: string }>(
          `SELECT provider_user_id FROM users WHERE id = $1`,
          [id]
        )
        if (!user?.provider_user_id) {
          return reply.status(400).send({ error: 'User has no media server association' })
        }

        const provider = await getMediaServerProvider()
        const apiKey = await getMediaServerApiKey()

        if (!apiKey) {
          return reply.status(500).send({ error: 'Media server API key not configured' })
        }

        await provider.markMoviePlayed(
          apiKey,
          user.provider_user_id,
          movie.provider_item_id,
          playedAt
        )

        // With a band, the viewer has just told us when — so set the date
        // rather than preserving whatever was there. The COALESCE on the
        // bodyless path stays: "I just watched this" should not overwrite a
        // real earlier play date that a resume point had already recorded.
        await query(
          `INSERT INTO watch_history (
             user_id, movie_id, media_type, play_count, last_played_at, played,
             approximate_played_at
           )
           VALUES ($1, $2, 'movie', 1, COALESCE($3::timestamptz, NOW()), true, $3::timestamptz)
           ON CONFLICT (user_id, movie_id) WHERE movie_id IS NOT NULL DO UPDATE SET
             play_count = GREATEST(watch_history.play_count, 1),
             last_played_at = COALESCE(
               $3::timestamptz,
               watch_history.last_played_at,
               NOW()
             ),
             played = true,
             -- Only a new estimate replaces the old one. Writing $3 flat would
             -- let a bodyless call clear the marker while COALESCE above keeps
             -- the estimated date, leaving a fabricated timestamp presented as
             -- an exact one — the single state this column exists to prevent.
             approximate_played_at = CASE
               WHEN $3::timestamptz IS NOT NULL THEN $3::timestamptz
               ELSE watch_history.approximate_played_at
             END,
             updated_at = NOW()`,
          [id, movieId, playedAt ?? null]
        )

        fastify.log.info({ userId: id, movieId, band, playedAt }, 'Movie marked as watched')
        return reply.send({ success: true, message: 'Movie marked as watched' })
      } catch (error) {
        fastify.log.error({ error, userId: id, movieId }, 'Failed to mark movie as watched')
        return reply.status(500).send({ error: 'Failed to mark movie as watched' })
      }
    }
  )

  /**
   * DELETE /api/users/:id/watch-history/movies/:movieId
   * Mark a movie as unwatched (removes from Emby and Aperture)
   */
  fastify.delete<{
    Params: { id: string; movieId: string }
  }>(
    '/api/users/:id/watch-history/movies/:movieId',
    { preHandler: requireAuth, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id, movieId } = request.params
      const currentUser = request.user as SessionUser

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      if (!(await canManageWatchHistory(id, currentUser))) {
        return reply.status(403).send({ error: 'Watch history management is not enabled for this user' })
      }

      try {
        const movie = await queryOne<{ provider_item_id: string }>(
          `SELECT provider_item_id FROM movies WHERE id = $1`,
          [movieId]
        )
        if (!movie) {
          return reply.status(404).send({ error: 'Movie not found' })
        }

        const user = await queryOne<{ provider_user_id: string }>(
          `SELECT provider_user_id FROM users WHERE id = $1`,
          [id]
        )
        if (!user?.provider_user_id) {
          return reply.status(400).send({ error: 'User has no media server association' })
        }

        const provider = await getMediaServerProvider()
        const apiKey = await getMediaServerApiKey()

        if (!apiKey) {
          return reply.status(500).send({ error: 'Media server API key not configured' })
        }

        await provider.markMovieUnplayed(apiKey, user.provider_user_id, movie.provider_item_id)

        await query(
          `DELETE FROM watch_history WHERE user_id = $1 AND movie_id = $2`,
          [id, movieId]
        )

        fastify.log.info({ userId: id, movieId }, 'Movie marked as unwatched')
        return reply.send({ success: true, message: 'Movie marked as unwatched' })
      } catch (error) {
        fastify.log.error({ error, userId: id, movieId }, 'Failed to mark movie as unwatched')
        return reply.status(500).send({ error: 'Failed to mark movie as unwatched' })
      }
    }
  )

  /**
   * DELETE /api/users/:id/watch-history/episodes/:episodeId
   * Mark a single episode as unwatched
   */
  fastify.delete<{
    Params: { id: string; episodeId: string }
  }>(
    '/api/users/:id/watch-history/episodes/:episodeId',
    { preHandler: requireAuth, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id, episodeId } = request.params
      const currentUser = request.user as SessionUser

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      if (!(await canManageWatchHistory(id, currentUser))) {
        return reply.status(403).send({ error: 'Watch history management is not enabled for this user' })
      }

      try {
        const episode = await queryOne<{ provider_item_id: string }>(
          `SELECT provider_item_id FROM episodes WHERE id = $1`,
          [episodeId]
        )
        if (!episode) {
          return reply.status(404).send({ error: 'Episode not found' })
        }

        const user = await queryOne<{ provider_user_id: string }>(
          `SELECT provider_user_id FROM users WHERE id = $1`,
          [id]
        )
        if (!user?.provider_user_id) {
          return reply.status(400).send({ error: 'User has no media server association' })
        }

        const provider = await getMediaServerProvider()
        const apiKey = await getMediaServerApiKey()

        if (!apiKey) {
          return reply.status(500).send({ error: 'Media server API key not configured' })
        }

        await provider.markEpisodeUnplayed(apiKey, user.provider_user_id, episode.provider_item_id)

        await query(
          `DELETE FROM watch_history WHERE user_id = $1 AND episode_id = $2`,
          [id, episodeId]
        )

        fastify.log.info({ userId: id, episodeId }, 'Episode marked as unwatched')
        return reply.send({ success: true, message: 'Episode marked as unwatched' })
      } catch (error) {
        fastify.log.error({ error, userId: id, episodeId }, 'Failed to mark episode as unwatched')
        return reply.status(500).send({ error: 'Failed to mark episode as unwatched' })
      }
    }
  )

  /**
   * DELETE /api/users/:id/watch-history/series/:seriesId/seasons/:seasonNumber
   * Mark all episodes in a season as unwatched
   */
  fastify.delete<{
    Params: { id: string; seriesId: string; seasonNumber: string }
  }>(
    '/api/users/:id/watch-history/series/:seriesId/seasons/:seasonNumber',
    { preHandler: requireAuth, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id, seriesId, seasonNumber } = request.params
      const currentUser = request.user as SessionUser

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      if (!(await canManageWatchHistory(id, currentUser))) {
        return reply.status(403).send({ error: 'Watch history management is not enabled for this user' })
      }

      try {
        const series = await queryOne<{ provider_item_id: string }>(
          `SELECT provider_item_id FROM series WHERE id = $1`,
          [seriesId]
        )
        if (!series) {
          return reply.status(404).send({ error: 'Series not found' })
        }

        const user = await queryOne<{ provider_user_id: string }>(
          `SELECT provider_user_id FROM users WHERE id = $1`,
          [id]
        )
        if (!user?.provider_user_id) {
          return reply.status(400).send({ error: 'User has no media server association' })
        }

        const provider = await getMediaServerProvider()
        const apiKey = await getMediaServerApiKey()

        if (!apiKey) {
          return reply.status(500).send({ error: 'Media server API key not configured' })
        }

        const { markedCount } = await provider.markSeasonUnplayed(
          apiKey,
          user.provider_user_id,
          series.provider_item_id,
          parseInt(seasonNumber)
        )

        await query(
          `DELETE FROM watch_history 
           WHERE user_id = $1 
             AND episode_id IN (
               SELECT id FROM episodes 
               WHERE series_id = $2 AND season_number = $3
             )`,
          [id, seriesId, parseInt(seasonNumber)]
        )

        fastify.log.info({ userId: id, seriesId, seasonNumber, markedCount }, 'Season marked as unwatched')
        return reply.send({ success: true, message: `${markedCount} episodes marked as unwatched` })
      } catch (error) {
        fastify.log.error({ error, userId: id, seriesId, seasonNumber }, 'Failed to mark season as unwatched')
        return reply.status(500).send({ error: 'Failed to mark season as unwatched' })
      }
    }
  )

  /**
   * DELETE /api/users/:id/watch-history/series/:seriesId
   * Mark all episodes in a series as unwatched
   */
  fastify.delete<{
    Params: { id: string; seriesId: string }
  }>(
    '/api/users/:id/watch-history/series/:seriesId',
    { preHandler: requireAuth, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id, seriesId } = request.params
      const currentUser = request.user as SessionUser

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      if (!(await canManageWatchHistory(id, currentUser))) {
        return reply.status(403).send({ error: 'Watch history management is not enabled for this user' })
      }

      try {
        const series = await queryOne<{ provider_item_id: string }>(
          `SELECT provider_item_id FROM series WHERE id = $1`,
          [seriesId]
        )
        if (!series) {
          return reply.status(404).send({ error: 'Series not found' })
        }

        const user = await queryOne<{ provider_user_id: string }>(
          `SELECT provider_user_id FROM users WHERE id = $1`,
          [id]
        )
        if (!user?.provider_user_id) {
          return reply.status(400).send({ error: 'User has no media server association' })
        }

        const provider = await getMediaServerProvider()
        const apiKey = await getMediaServerApiKey()

        if (!apiKey) {
          return reply.status(500).send({ error: 'Media server API key not configured' })
        }

        const { markedCount } = await provider.markSeriesUnplayed(
          apiKey,
          user.provider_user_id,
          series.provider_item_id
        )

        await query(
          `DELETE FROM watch_history 
           WHERE user_id = $1 
             AND episode_id IN (SELECT id FROM episodes WHERE series_id = $2)`,
          [id, seriesId]
        )

        fastify.log.info({ userId: id, seriesId, markedCount }, 'Series marked as unwatched')
        return reply.send({ success: true, message: `${markedCount} episodes marked as unwatched` })
      } catch (error) {
        fastify.log.error({ error, userId: id, seriesId }, 'Failed to mark series as unwatched')
        return reply.status(500).send({ error: 'Failed to mark series as unwatched' })
      }
    }
  )
}
