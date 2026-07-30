/**
 * Deployment Posture Handlers
 *
 * Endpoints:
 * - GET   /api/settings/deployment - Effective security posture + findings
 * - PATCH /api/settings/deployment - Set the trusted proxy list
 *
 * Only the proxy list is writable, because it is the only one of these that can
 * be changed on a live server: Fastify consults `trustProxy` per request when
 * it is a function, so a save takes effect immediately (see config/proxyTrust).
 * The rest are read at startup, so the panel reports them and says what to set.
 */
import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../../plugins/auth.js'
import { getDeploymentPosture } from '../../../config/deploymentPosture.js'
import { setTrustedProxies, proxyTrustIsEnvManaged } from '../../../config/proxyTrust.js'

interface UpdateBody {
  trustedProxies?: string[]
}

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

  fastify.patch<{ Body: UpdateBody }>(
    '/api/settings/deployment',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      const { trustedProxies } = request.body ?? {}

      if (!Array.isArray(trustedProxies)) {
        return reply.status(400).send({ error: 'trustedProxies must be an array of strings' })
      }

      if (trustedProxies.some((entry) => typeof entry !== 'string')) {
        return reply.status(400).send({ error: 'trustedProxies must contain only strings' })
      }

      // Refuse rather than accept a value that would never be used — silently
      // storing something the environment overrides is how an operator ends up
      // certain they configured this and equally certain it is broken.
      if (proxyTrustIsEnvManaged()) {
        return reply.status(409).send({
          error:
            'Trusted proxies are set by the TRUST_PROXY environment variable. ' +
            'Remove it to manage them here.',
        })
      }

      try {
        const saved = await setTrustedProxies(trustedProxies)
        return reply.send({ trustedProxies: saved, posture: getDeploymentPosture() })
      } catch (err) {
        // validateProxyEntries rejects anything proxy-addr cannot compile; that
        // is the admin's input, not a server fault.
        const message = err instanceof Error ? err.message : 'Invalid trusted proxy list'
        fastify.log.warn({ err }, 'Rejected trusted proxy update')
        return reply.status(400).send({ error: message })
      }
    }
  )
}
