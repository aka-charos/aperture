/**
 * Setup Routes
 *
 * Public endpoints for first-run setup wizard.
 * These endpoints only work when the system is not yet configured.
 */

import type { FastifyPluginAsync } from 'fastify'
import { setupFence } from './fence.js'
import {
  registerStatusHandlers,
  registerMediaServerHandlers,
  registerLibrariesHandlers,
  registerOutputHandlers,
  registerUsersHandlers,
  registerOpenAIHandlers,
  registerJobsHandlers,
  registerTopPicksHandlers,
  registerAIHandlers,
  registerAdminHandlers,
} from './handlers/index.js'

const setupRoutes: FastifyPluginAsync = async (fastify) => {
  // Scoped to this plugin, so it covers every setup route including ones added
  // later. Handlers still apply their own `requireSetupWritable` check on top.
  fastify.addHook('onRequest', setupFence)

  // Register all handler groups
  await registerStatusHandlers(fastify)
  await registerMediaServerHandlers(fastify)
  await registerLibrariesHandlers(fastify)
  await registerOutputHandlers(fastify)
  await registerUsersHandlers(fastify)
  await registerOpenAIHandlers(fastify)
  await registerJobsHandlers(fastify)
  await registerTopPicksHandlers(fastify)
  await registerAIHandlers(fastify)
  await registerAdminHandlers(fastify)
}

export default setupRoutes
