/**
 * System Settings Handlers
 *
 * Endpoints:
 * - GET /api/settings/system/logging - Get logging preferences
 * - PUT /api/settings/system/logging - Update logging preferences
 */
import type { FastifyInstance } from 'fastify'
import { getSystemSetting, setSystemSetting } from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'
import { QUIET_POLL_LOGS_SETTING, refreshQuietPollState } from '../../../config/logging.js'

export function registerSystemHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/settings/system/logging
   */
  fastify.get(
    '/api/settings/system/logging',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      try {
        const quietPollLogs = (await getSystemSetting(QUIET_POLL_LOGS_SETTING)) === 'true'
        return reply.send({ quietPollLogs })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get logging settings')
        return reply.status(500).send({ error: 'Failed to get logging settings' })
      }
    }
  )

  /**
   * PUT /api/settings/system/logging
   */
  fastify.put<{ Body: { quietPollLogs?: boolean } }>(
    '/api/settings/system/logging',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const { quietPollLogs } = request.body
        if (typeof quietPollLogs !== 'boolean') {
          return reply.status(400).send({ error: 'quietPollLogs must be a boolean' })
        }

        await setSystemSetting(
          QUIET_POLL_LOGS_SETTING,
          quietPollLogs ? 'true' : 'false',
          'Suppress access logs for high-frequency UI poll routes'
        )
        // Apply immediately to the running request-logging hooks.
        await refreshQuietPollState()

        return reply.send({ quietPollLogs })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update logging settings')
        return reply.status(500).send({ error: 'Failed to update logging settings' })
      }
    }
  )
}
