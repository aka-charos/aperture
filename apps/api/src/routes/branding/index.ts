/**
 * Branding Routes
 *
 * - GET  /api/branding  (public) - the instance's display name
 * - PUT  /api/branding  (admin)  - rename the instance
 *
 * The GET is deliberately unauthenticated: the login page and the setup wizard
 * both show the name, and they run before anyone has a session. It exposes
 * nothing an anonymous visitor can't already read off the page they're looking
 * at.
 */
import type { FastifyPluginAsync } from 'fastify'
import { getAppName, setAppName, APP_NAME_MAX_LENGTH } from '@aperture/core'
import { requireAdmin } from '../../plugins/auth.js'

const brandingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/branding', { schema: { tags: ['settings'] } }, async (_request, reply) => {
    try {
      // The name is read on every cold load and changes about once ever, but a
      // stale tab title after a rename is exactly the confusing case this
      // feature exists to avoid.
      void reply.header('Cache-Control', 'no-store')
      return reply.send({ appName: await getAppName() })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to read branding')
      return reply.status(500).send({ error: 'Failed to read branding' })
    }
  })

  fastify.put<{ Body: { appName?: unknown } }>(
    '/api/branding',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const { appName } = request.body ?? {}
        if (appName !== undefined && typeof appName !== 'string') {
          return reply.status(400).send({ error: 'appName must be a string' })
        }
        if (typeof appName === 'string' && appName.length > APP_NAME_MAX_LENGTH * 4) {
          // Generous: setAppName trims to the real limit. This only rejects
          // something pasted in by mistake, so the DB never stores an essay.
          return reply.status(400).send({ error: 'appName is too long' })
        }
        // An empty string is a reset, not an error — see setAppName.
        return reply.send({ appName: await setAppName(appName) })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update branding')
        return reply.status(500).send({ error: 'Failed to update branding' })
      }
    }
  )
}

export default brandingRoutes
