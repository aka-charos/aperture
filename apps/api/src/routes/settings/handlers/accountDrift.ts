/**
 * Account drift
 *
 * Endpoints:
 * - GET /api/settings/account-drift - Compare the media server's, LLDAP's and
 *   Aperture's accounts (core `users/accountDrift.ts`)
 *
 * Read-only and read live: the card under Outgoing email calls it on opening
 * and on Refresh. A directory that cannot be read comes back as a source
 * state beside the rest, never as an error status, so the card can say which
 * one failed.
 */
import type { FastifyInstance } from 'fastify'
import { loadAccountDriftReport } from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

export function registerAccountDriftHandlers(fastify: FastifyInstance) {
  fastify.get(
    '/api/settings/account-drift',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      try {
        return reply.send(await loadAccountDriftReport())
      } catch (err) {
        fastify.log.error({ err }, 'Failed to compare accounts')
        return reply.status(500).send({ error: 'Failed to compare accounts' })
      }
    }
  )
}
