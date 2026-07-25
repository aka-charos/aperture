import type { FastifyPluginAsync } from 'fastify'
import { requireAuth, type SessionUser } from '../../plugins/auth.js'
import {
  setFavoritesForUser,
  getFavoriteStatusForUser,
  getFavoriteStatusesForUser,
} from '@aperture/core'

const favoritesRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/favorites/status
   * Whether a movie or series is favorited in the current user's media-server account.
   * Query: movieId or seriesId (exactly one).
   */
  fastify.get<{
    Querystring: { movieId?: string; seriesId?: string }
  }>(
    '/api/favorites/status',
    { preHandler: requireAuth, schema: { tags: ['favorites'] } },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { movieId, seriesId } = request.query

      if ((!movieId && !seriesId) || (movieId && seriesId)) {
        return reply.status(400).send({ error: 'Provide exactly one of movieId or seriesId' })
      }

      try {
        const favorite = await getFavoriteStatusForUser(currentUser.id, { movieId, seriesId })
        return reply.send({ favorite })
      } catch (err) {
        request.log.error({ err, userId: currentUser.id }, 'Failed to fetch favorite status')
        const message = err instanceof Error ? err.message : 'Failed to fetch favorite status'
        return reply.status(500).send({ error: message })
      }
    }
  )

  /**
   * POST /api/favorites/status/bulk
   * Favorite status for many items at once — one request instead of one per card.
   * Body: { movieIds?, seriesIds? }. Responds with the favorited SUBSET of those ids.
   */
  fastify.post<{
    Body: { movieIds?: string[]; seriesIds?: string[] }
  }>(
    '/api/favorites/status/bulk',
    { preHandler: requireAuth, schema: { tags: ['favorites'] } },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { movieIds = [], seriesIds = [] } = request.body || {}

      if (movieIds.length === 0 && seriesIds.length === 0) {
        return reply.send({ movieIds: [], seriesIds: [] })
      }

      try {
        const result = await getFavoriteStatusesForUser(currentUser.id, movieIds, seriesIds)
        return reply.send(result)
      } catch (err) {
        request.log.error({ err, userId: currentUser.id }, 'Failed to fetch favorite statuses')
        const message = err instanceof Error ? err.message : 'Failed to fetch favorite statuses'
        return reply.status(500).send({ error: message })
      }
    }
  )

  /**
   * POST /api/favorites
   * Mark or unmark movies/series as favorites in the current user's media-server account.
   * Body: { movieIds?, seriesIds?, favorite? } — favorite defaults to true.
   */
  fastify.post<{
    Body: {
      movieIds?: string[]
      seriesIds?: string[]
      favorite?: boolean
    }
  }>(
    '/api/favorites',
    { preHandler: requireAuth, schema: { tags: ['favorites'] } },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { movieIds = [], seriesIds = [], favorite = true } = request.body || {}

      if (movieIds.length === 0 && seriesIds.length === 0) {
        return reply.status(400).send({ error: 'At least one movie or series ID is required' })
      }

      try {
        const result = await setFavoritesForUser(currentUser.id, movieIds, seriesIds, favorite)
        return reply.send(result)
      } catch (err) {
        request.log.error({ err, userId: currentUser.id }, 'Failed to update favorites')
        const message = err instanceof Error ? err.message : 'Failed to update favorites'
        return reply.status(500).send({ error: message })
      }
    }
  )
}

export default favoritesRoutes
