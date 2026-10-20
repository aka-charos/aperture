import type { FastifyPluginAsync } from 'fastify'
import { requireAuth, type SessionUser } from '../../plugins/auth.js'
import { titleInScope, viewerScope } from '../../lib/viewerScope.js'
import {
  getSimilarMovies,
  getSimilarSeries,
  getSimilarWithDepth,
  getGraphForSource,
  semanticSearch,
  buildGraphFromSemanticSearch,
  CONNECTION_COLORS,
  getValidationCacheStats,
  clampGraphCount,
  MAX_GRAPH_DEPTH,
  MAX_GRAPH_LIMIT,
  type GraphSource,
} from '@aperture/core'
import { similaritySchemas } from './schemas.js'

/**
 * A count from the querystring: absent is `fallback`, anything that is not a
 * whole number is refused (null), and a number is clamped to [1, max]. Every
 * one of these sizes a loop of kNN queries, and depth sizes paid model calls,
 * so none may be whatever the caller typed.
 */
function readCount(raw: string | undefined, fallback: number, max: number): number | null {
  if (raw == null || raw === '') return fallback
  if (!/^\d+$/.test(raw)) return null
  return clampGraphCount(Number(raw), fallback, max)
}

/** 'true' or 'false' from the querystring; anything else is absent. */
function readFlag(raw: string | undefined): boolean | undefined {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

const similarityRoutes: FastifyPluginAsync = async (fastify) => {
  // Register schemas
  for (const [name, schema] of Object.entries(similaritySchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  /**
   * GET /api/similarity/movie/:id
   * Get similar movies for a given movie
   * 
   * Query params:
   * - limit: Max connections (default: 12)
   * - depth: How many levels (1 = direct, 2 = spider out) (default: 1)
   * 
   * User preferences are automatically applied:
   * - fullFranchiseMode: Show entire franchise without limits
   * - hideWatched: Filter out already-watched content
   */
  fastify.get<{
    Params: { id: string }
    Querystring: { limit?: string; depth?: string; hideWatched?: string }
  }>('/api/similarity/movie/:id', { preHandler: requireAuth, schema: { tags: ["similarity"] } }, async (request, reply) => {
    const { id } = request.params
    const currentUser = request.user as SessionUser
    const limit = readCount(request.query.limit, 12, MAX_GRAPH_LIMIT)
    const depth = readCount(request.query.depth, 1, MAX_GRAPH_DEPTH)
    if (limit == null || depth == null) {
      return reply.status(400).send({ error: 'limit and depth must be whole numbers' })
    }
    // The Explore switch, when sent; otherwise the stored preference applies.
    const hideWatched = readFlag(request.query.hideWatched)

    // A title the viewer may not open answers like one that does not exist.
    if (!(await titleInScope(request, 'movies', id))) {
      return reply.status(404).send({ error: `Movie not found: ${id}` })
    }
    const scope = await viewerScope(request)

    try {
      // If depth > 1, return graph data for multi-level view
      if (depth > 1) {
        const graphData = await getSimilarWithDepth(id, 'movie', { limit, depth, userId: currentUser.id, scope, hideWatched })
        return reply.send(graphData)
      }

      const result = await getSimilarMovies(id, { limit, scope })
      return reply.send(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('not found')) {
        return reply.status(404).send({ error: message })
      }
      throw error
    }
  })

  /**
   * GET /api/similarity/series/:id
   * Get similar series for a given series
   * 
   * Query params:
   * - limit: Max connections (default: 12)
   * - depth: How many levels (1 = direct, 2 = spider out) (default: 1)
   * 
   * User preferences are automatically applied:
   * - fullFranchiseMode: Show entire franchise without limits
   * - hideWatched: Filter out already-watched content
   */
  fastify.get<{
    Params: { id: string }
    Querystring: { limit?: string; depth?: string; hideWatched?: string }
  }>('/api/similarity/series/:id', { preHandler: requireAuth, schema: { tags: ["similarity"] } }, async (request, reply) => {
    const { id } = request.params
    const currentUser = request.user as SessionUser
    const limit = readCount(request.query.limit, 12, MAX_GRAPH_LIMIT)
    const depth = readCount(request.query.depth, 1, MAX_GRAPH_DEPTH)
    if (limit == null || depth == null) {
      return reply.status(400).send({ error: 'limit and depth must be whole numbers' })
    }
    // The Explore switch, when sent; otherwise the stored preference applies.
    const hideWatched = readFlag(request.query.hideWatched)

    if (!(await titleInScope(request, 'series', id))) {
      return reply.status(404).send({ error: `Series not found: ${id}` })
    }
    const scope = await viewerScope(request)

    try {
      // If depth > 1, return graph data for multi-level view
      if (depth > 1) {
        const graphData = await getSimilarWithDepth(id, 'series', { limit, depth, userId: currentUser.id, scope, hideWatched })
        return reply.send(graphData)
      }

      const result = await getSimilarSeries(id, { limit, scope })
      return reply.send(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('not found')) {
        return reply.status(404).send({ error: message })
      }
      throw error
    }
  })

  /**
   * GET /api/similarity/graph/:source
   * Get graph data for a specific source (explore page)
   *
   * Sources:
   * - ai-movies: User's AI recommended movies
   * - ai-series: User's AI recommended series
   * - watching: User's currently watching series
   * - top-movies: Top picks movies
   * - top-series: Top picks series
   */
  fastify.get<{
    Params: { source: string }
    Querystring: { limit?: string; crossMedia?: string; hideWatched?: string }
  }>('/api/similarity/graph/:source', { preHandler: requireAuth, schema: { tags: ["similarity"] } }, async (request, reply) => {
    const { source } = request.params
    const currentUser = request.user as SessionUser

    const validSources: GraphSource[] = [
      'ai-movies',
      'ai-series',
      'watching',
      'top-movies',
      'top-series',
    ]

    if (!validSources.includes(source as GraphSource)) {
      return reply.status(400).send({
        error: `Invalid source. Must be one of: ${validSources.join(', ')}`,
      })
    }

    const limit = readCount(request.query.limit, 20, MAX_GRAPH_LIMIT)
    if (limit == null) {
      return reply.status(400).send({ error: 'limit must be a whole number' })
    }
    const includeCrossMedia = request.query.crossMedia === 'true'
    const hideWatched = request.query.hideWatched === 'true'

    try {
      const result = await getGraphForSource(source as GraphSource, currentUser.id, {
        scope: await viewerScope(request),
        limit,
        includeCrossMedia,
        hideWatched,
      })
      return reply.send(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      fastify.log.error({ error, source, userId: currentUser.id }, 'Failed to get graph data')
      return reply.status(500).send({ error: message })
    }
  })

  /**
   * GET /api/similarity/search
   * Semantic search across library content
   *
   * Query params:
   * - q: Search query (required) e.g., "Psychological thrillers with twist endings"
   * - type: Filter by type - 'movie', 'series', or 'both' (default: 'both')
   * - limit: Max results (default: 20)
   * - graph: If 'true', return graph data with connections (default: 'false')
   * - hideWatched: If 'true', exclude previously watched content (default: 'false')
   */
  fastify.get<{
    Querystring: { q?: string; type?: string; limit?: string; graph?: string; hideWatched?: string }
  }>('/api/similarity/search', { preHandler: requireAuth, schema: { tags: ["similarity"] } }, async (request, reply) => {
    const { q: searchQuery, type, limit: limitStr, graph, hideWatched: hideWatchedStr } = request.query
    const currentUser = request.user as SessionUser

    if (!searchQuery || !searchQuery.trim()) {
      return reply.status(400).send({ error: 'Search query (q) is required' })
    }

    const validTypes = ['movie', 'series', 'both']
    const searchType = (type && validTypes.includes(type) ? type : 'both') as
      | 'movie'
      | 'series'
      | 'both'
    const limit = readCount(limitStr, 20, MAX_GRAPH_LIMIT)
    if (limit == null) {
      return reply.status(400).send({ error: 'limit must be a whole number' })
    }
    const returnGraph = graph === 'true'
    const hideWatched = hideWatchedStr === 'true'

    try {
      const scope = await viewerScope(request)
      const searchResult = await semanticSearch(searchQuery, {
        type: searchType,
        limit,
        hideWatched,
        userId: currentUser.id,
        scope,
      })

      if (returnGraph) {
        // Build graph with connections between results; the switch covers the
        // titles discovered around the results too, not just the results.
        const graphData = await buildGraphFromSemanticSearch(searchResult, {
          scope,
          hideWatchedFor: hideWatched ? currentUser.id : undefined,
        })
        return reply.send({
          query: searchResult.query,
          resultCount: searchResult.results.length,
          graph: graphData,
        })
      }

      return reply.send(searchResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      fastify.log.error({ error, searchQuery, type }, 'Semantic search failed')
      return reply.status(500).send({ error: message })
    }
  })

  /**
   * GET /api/similarity/colors
   * Get the color scheme for connection types
   */
  fastify.get('/api/similarity/colors', { preHandler: requireAuth, schema: { tags: ["similarity"] } }, async (_request, reply) => {
    return reply.send(CONNECTION_COLORS)
  })

  /**
   * GET /api/similarity/validation-cache/stats
   * Get statistics about the AI validation cache
   */
  fastify.get('/api/similarity/validation-cache/stats', { preHandler: requireAuth, schema: { tags: ["similarity"] } }, async (_request, reply) => {
    const stats = await getValidationCacheStats()
    return reply.send(stats)
  })
}

export default similarityRoutes
