/**
 * Next from here: what to watch after a title, with reasons. Every answer is
 * limited to the viewer's library scope, and a title out of scope answers
 * exactly like one that does not exist. The work is core's
 * (packages/core/src/nextFromHere/); this file only reads the request.
 */

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../plugins/auth.js'
import { viewerScope } from '../../lib/viewerScope.js'
import { getNextFromHere, parseTitleRef } from '@aperture/core'

const nextFromHereRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/next-from-here[?title=movie:<id>] — titles close in feel to the
   * start and titles sharing its people in a different feel, each with the
   * reasons it is there, plus recent titles to start from instead. With no
   * `title`, the start is the viewer's most recent title they finished and did
   * not dislike (`start` is null when there is none).
   */
  fastify.get<{ Querystring: { title?: string } }>(
    '/api/next-from-here',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['next-from-here'],
        querystring: { type: 'object', properties: { title: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const userId = request.user?.id
      if (!userId) return reply.status(401).send({ error: 'Not signed in' })
      let ref = null
      if (request.query.title) {
        ref = parseTitleRef(request.query.title)
        if (!ref) return reply.status(400).send({ error: 'title must be movie:<id> or series:<id>' })
      }
      const result = await getNextFromHere(await viewerScope(request), userId, ref)
      if (!result) return reply.status(404).send({ error: 'Title not found' })
      return result
    }
  )
}

export default nextFromHereRoutes
