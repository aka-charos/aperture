/**
 * Deployment Posture Handler
 *
 * Endpoints:
 * - GET /api/settings/deployment - Effective security posture + findings
 *
 * Read-only by design. Everything it reports is env-driven, and the one setting
 * that matters most (trustProxy) is baked into Fastify's Request class at
 * construction — Fastify offers no way to change it on a running server. A
 * writable toggle here would appear to work and silently do nothing until the
 * next restart, so the panel reports and advises instead.
 */
import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../../plugins/auth.js'
import { getDeploymentPosture } from '../../../config/deploymentPosture.js'

export function registerDeploymentHandlers(fastify: FastifyInstance) {
  fastify.get(
    '/api/settings/deployment',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      try {
        return reply.send(getDeploymentPosture())
      } catch (err) {
        fastify.log.error({ err }, 'Failed to read deployment posture')
        return reply.status(500).send({ error: 'Failed to read deployment posture' })
      }
    }
  )
}
