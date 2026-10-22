/**
 * Next from here: what to watch after a title, with reasons. Every answer is
 * limited to the viewer's library scope, and a title out of scope answers
 * exactly like one that does not exist. The work is core's
 * (packages/core/src/nextFromHere/); this file only reads the request.
 */

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../plugins/auth.js'
import { viewerScope } from '../../lib/viewerScope.js'
import { getNextFromHere, NEXT_MAX_AVOID, parseTitleRef, type TrailTitleRef } from '@aperture/core'

const nextFromHereRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/next-from-here[?title=movie:<id>][&avoid=<ref>,<ref>] — titles
   * close in feel to the start, each with the reasons it is there; the people
   * behind it and what else of theirs is in the library; the map's titles and
   * lines; and recent titles to start from instead. With no `title`, the start
   * is the viewer's most recent title they finished and did not dislike
   * (`start` is null when there is none). `avoid` is the earlier steps of the
   * viewer's trail, never suggested again; a malformed ref in it is ignored.
   */
  fastify.get<{ Querystring: { title?: string; avoid?: string } }>(
    '/api/next-from-here',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['next-from-here'],
        querystring: {
          type: 'object',
          properties: { title: { type: 'string' }, avoid: { type: 'string' } },
        },
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
      const avoid = (request.query.avoid ?? '')
        .split(',')
        .slice(0, NEXT_MAX_AVOID)
        .map((raw) => parseTitleRef(raw.trim()))
        .filter((step): step is TrailTitleRef => step != null)
      const result = await getNextFromHere(await viewerScope(request), userId, ref, avoid)
      if (!result) return reply.status(404).send({ error: 'Title not found' })
      return result
    }
  )
}

export default nextFromHereRoutes
