/**
 * Setup Routes
 *
 * Public endpoints for first-run setup wizard.
 * These endpoints only work when the system is not yet configured.
 */

import type { FastifyPluginAsync } from 'fastify'
import { isSetupComplete } from '@aperture/core'
import { isTrustedSetupSource, setupAllowsRemote } from '../../config/security.js'
import {
  registerStatusHandlers,
  registerMediaServerHandlers,
  registerLibrariesHandlers,
  registerOutputHandlers,
  registerValidationHandlers,
  registerUsersHandlers,
  registerOpenAIHandlers,
  registerJobsHandlers,
  registerTopPicksHandlers,
  registerAIHandlers,
  registerAdminHandlers,
} from './handlers/index.js'

/**
 * Read-only probe the SPA calls on every load to decide whether to show the
 * wizard. Left reachable so a remote visitor gets a working page rather than a
 * broken one; it discloses only whether setup is pending.
 */
const ALWAYS_REACHABLE = new Set(['/api/setup/status'])

const setupRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Until setup completes there is no account to authenticate against, so these
   * routes have to run unauthenticated — and they configure the media server,
   * create the first admin and can trigger outbound requests. Restricting them
   * to callers on the local network closes the window in which whoever reaches
   * a freshly-started instance first owns it.
   *
   * Scoped to this plugin, so it covers every setup route including ones added
   * later. Admins keep access for post-setup reconfiguration, and handlers
   * still apply their own `requireSetupWritable` check on top of this.
   */
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.user?.isAdmin) return
    if (ALWAYS_REACHABLE.has(request.url.split('?')[0])) return

    // Post-setup, the individual handlers already 404 for non-admins.
    if (await isSetupComplete()) return

    if (setupAllowsRemote()) return
    if (isTrustedSetupSource(request.ip)) return

    request.log.warn(
      { url: request.url },
      'Blocked first-run setup request from a non-local address'
    )
    return reply.status(403).send({
      error:
        'First-run setup is only available from the local network. ' +
        'Run it from the same network as the server, or set SETUP_ALLOW_REMOTE=true to override. ' +
        'If Aperture is behind a reverse proxy, TRUST_PROXY must also be configured.',
    })
  })

  // Register all handler groups
  await registerStatusHandlers(fastify)
  await registerMediaServerHandlers(fastify)
  await registerLibrariesHandlers(fastify)
  await registerOutputHandlers(fastify)
  await registerValidationHandlers(fastify)
  await registerUsersHandlers(fastify)
  await registerOpenAIHandlers(fastify)
  await registerJobsHandlers(fastify)
  await registerTopPicksHandlers(fastify)
  await registerAIHandlers(fastify)
  await registerAdminHandlers(fastify)
}

export default setupRoutes
