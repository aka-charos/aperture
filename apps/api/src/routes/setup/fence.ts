/**
 * Who may reach first-run setup.
 *
 * Until setup completes there is no account to authenticate against, so these
 * routes have to run unauthenticated, and they configure the media server, create
 * the first admin, restore backups and can trigger outbound requests. Restricting
 * them to callers on the local network closes the window in which whoever reaches
 * a freshly-started instance first owns it.
 *
 * The routes live in two plugins (this folder's, and the backup restore step in
 * routes/backup), so one hook is shared rather than each plugin holding a copy.
 * Admins keep access for post-setup reconfiguration.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import { isSetupComplete } from '@aperture/core'
import { isTrustedSetupSource, setupAllowsRemote } from '../../config/security.js'
import { originCouldBeRebound } from '../../config/cors.js'

/**
 * Read-only probe the SPA calls on every load to decide whether to show the
 * wizard. Left reachable so a remote visitor gets a working page rather than a
 * broken one; it discloses only whether setup is pending.
 */
const ALWAYS_REACHABLE = new Set(['/api/setup/status'])

async function fence(
  request: FastifyRequest,
  reply: FastifyReply,
  onceComplete: 'handlers-decide' | 'closed'
) {
  if (request.user?.isAdmin) return
  if (ALWAYS_REACHABLE.has(request.url.split('?')[0])) return

  const allowsRemote = setupAllowsRemote()

  // A local caller may still be a web page some other site pointed here. Asked
  // before the setup check: after setup such a page has no business here either,
  // and a database read should not stand between it and the refusal.
  if (!allowsRemote && originCouldBeRebound(request.headers.origin)) {
    request.log.warn({ url: request.url }, 'Blocked first-run setup request by its Origin')
    return reply.status(403).send({
      error:
        'First-run setup has to be opened by the server\'s IP address or by APP_BASE_URL. ' +
        'Set APP_BASE_URL to this address, or set SETUP_ALLOW_REMOTE=true to override.',
    })
  }

  if (await isSetupComplete()) {
    if (onceComplete === 'handlers-decide') return
    return reply.status(404).send({ error: 'Not Found' })
  }

  if (allowsRemote || isTrustedSetupSource(request.ip)) return

  request.log.warn({ url: request.url }, 'Blocked first-run setup request from a non-local address')
  return reply.status(403).send({
    error:
      'First-run setup is only available from the local network. ' +
      'Run it from the same network as the server, or set SETUP_ALLOW_REMOTE=true to override. ' +
      'If Aperture is behind a reverse proxy, TRUST_PROXY must also be configured.',
  })
}

/** For this folder's plugin, whose handlers 404 for non-admins once setup is done. */
export function setupFence(request: FastifyRequest, reply: FastifyReply) {
  return fence(request, reply, 'handlers-decide')
}

/** For a setup route with no such check of its own: closes when setup completes. */
export function setupFenceClosingOnComplete(request: FastifyRequest, reply: FastifyReply) {
  return fence(request, reply, 'closed')
}
