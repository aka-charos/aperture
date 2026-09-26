/**
 * Similar Movies Handler
 * 
 * GET /api/movies/:id/similar - Get similar movies based on embedding similarity
 */
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../../plugins/auth.js'
import { titleInScope, viewerScope } from '../../../lib/viewerScope.js'
import { getSimilarMovies } from '@aperture/core'
import { similarMoviesSchema } from '../schemas.js'

export function registerSimilarHandler(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/movies/:id/similar',
    {
      preHandler: requireAuth,
      schema: similarMoviesSchema,
    },
    async (request, reply) => {
      const { id } = request.params
      const limit = Math.min(parseInt(request.query.limit || '10', 10), 50)

      // Nothing for a title the viewer may not open, and nothing from a
      // library they may not open either (lib/viewerScope.ts).
      if (!(await titleInScope(request, 'movies', id))) {
        return reply.send({ similar: [], message: 'No embedding found for this movie' })
      }

      try {
        const result = await getSimilarMovies(id, { limit, scope: await viewerScope(request) })
        
        // Transform to the expected response format
        const similar = result.connections.map((conn) => ({
          id: conn.item.id,
          title: conn.item.title,
          year: conn.item.year,
          poster_url: conn.item.poster_url,
          genres: conn.item.genres,
          similarity: conn.similarity,
          reasons: conn.reasons,
        }))

        return reply.send({ similar })
      } catch {
        // Movie not found or no embedding
        return reply.send({ similar: [], message: 'No embedding found for this movie' })
      }
    }
  )
}
