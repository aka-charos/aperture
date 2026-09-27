/**
 * Social layer: admin-managed connections, the Shared with me inbox, and what
 * connections watched lately. Design record: docs/plans/social-connections.md.
 *
 * No capability guard: having a connection is data, not a permission, and every
 * endpoint answers for the caller's own connections (an empty list for someone
 * with none). The four admin routes use `requireAdmin`. Writes are refused
 * during "view as" and for read-only API keys by the shared write guard
 * (lib/requestWrites.ts); nothing here is added to its exception lists.
 */
import type { FastifyPluginAsync } from 'fastify'
import { registerConnectionHandlers } from './handlers/connections.js'
import { registerRecommendationHandlers } from './handlers/recommendations.js'
import { registerRecentWatchesHandler } from './handlers/recentWatches.js'

const socialRoutes: FastifyPluginAsync = async (fastify) => {
  registerConnectionHandlers(fastify)
  registerRecommendationHandlers(fastify)
  registerRecentWatchesHandler(fastify)
}

export default socialRoutes
