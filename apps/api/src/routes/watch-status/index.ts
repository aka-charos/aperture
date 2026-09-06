/**
 * Watch status for the whole library, in one request.
 *
 * The poster grids need "has this viewer finished this title?" for every card
 * on screen, across a dozen pages fed by ten different list endpoints. A flag
 * on each of those endpoints would be ten copies of the predicate and ten
 * chances for them to drift; one set fetched per page load is the same shape
 * as GET /api/ratings, which every poster already reads its heart from.
 *
 * Named `watch-status` rather than `watched` because `/api/watching` already
 * exists and means something else entirely (the Shows You Watch list).
 */
import type { FastifyPluginAsync } from 'fastify'
import { requireAuth, type SessionUser } from '../../plugins/auth.js'
import { getWatchedItemIdsForUser } from '@aperture/core'

const watchStatusRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/watch-status
   * Ids of every movie the current user has played, and of every series whose
   * episodes they have all played. Absent from either list means "not
   * finished", never "unknown" — the answer covers the whole library.
   */
  fastify.get(
    '/api/watch-status',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['watching'],
        description:
          'Watched movie ids and fully-watched series ids for the current user.',
        response: {
          200: {
            type: 'object',
            properties: {
              movieIds: { type: 'array', items: { type: 'string' } },
              seriesIds: { type: 'array', items: { type: 'string' } },
            },
          },
          500: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const currentUser = request.user as SessionUser

      try {
        const ids = await getWatchedItemIdsForUser(currentUser.id)
        return reply.send(ids)
      } catch (err) {
        request.log.error({ err, userId: currentUser.id }, 'Failed to fetch watch status')
        return reply.status(500).send({ error: 'Failed to fetch watch status' })
      }
    }
  )
}

export default watchStatusRoutes
