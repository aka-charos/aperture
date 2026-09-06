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
import { getWatchStatusForUser } from '@aperture/core'

const watchStatusRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/watch-status
   * Ids of every movie the current user has played, plus episode counts for
   * every series they have started (specials excluded). Absent means "not
   * started", never "unknown" — the answer covers the whole library.
   */
  fastify.get(
    '/api/watch-status',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['watching'],
        description:
          'Watched movie ids, and watched/total episode counts per started series, for the current user.',
        response: {
          200: {
            type: 'object',
            properties: {
              movieIds: { type: 'array', items: { type: 'string' } },
              series: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    watched: { type: 'integer' },
                    total: { type: 'integer' },
                  },
                },
              },
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
        const status = await getWatchStatusForUser(currentUser.id)
        return reply.send(status)
      } catch (err) {
        request.log.error({ err, userId: currentUser.id }, 'Failed to fetch watch status')
        return reply.status(500).send({ error: 'Failed to fetch watch status' })
      }
    }
  )
}

export default watchStatusRoutes
