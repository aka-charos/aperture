import type { FastifyPluginAsync } from 'fastify'
import { requireAuth, type SessionUser } from '../../plugins/auth.js'
import { setFavoritesForUser } from '@aperture/core'

const favoritesRoutes: FastifyPluginAsync = async (fastify) => {
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
