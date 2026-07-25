/**
 * System Settings Handlers
 *
 * Endpoints:
 * - GET /api/settings/system/logging - Get logging preferences
 * - PUT /api/settings/system/logging - Update logging preferences
 * - GET /api/settings/poster-display - Get instance-wide poster display defaults
 * - PATCH /api/settings/poster-display - Update instance-wide poster display defaults
 */
import type { FastifyInstance } from 'fastify'
import {
  getSystemSetting,
  setSystemSetting,
  getPosterDisplayConfig,
  setPosterDisplayConfig,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'
import { QUIET_POLL_LOGS_SETTING, refreshQuietPollState } from '../../../config/logging.js'
import { MASK_LOG_URLS_SETTING, refreshLogMaskingState } from '../../../config/logMasking.js'

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
        const maskLogUrls = (await getSystemSetting(MASK_LOG_URLS_SETTING)) === 'true'
        return reply.send({ quietPollLogs, maskLogUrls })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get logging settings')
        return reply.status(500).send({ error: 'Failed to get logging settings' })
      }
    }
  )

  /**
   * PUT /api/settings/system/logging
   */
  fastify.put<{ Body: { quietPollLogs?: boolean; maskLogUrls?: boolean } }>(
    '/api/settings/system/logging',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const { quietPollLogs, maskLogUrls } = request.body
        // Each toggle saves on its own, so an older client that only knows
        // about quietPollLogs can't blank the other one.
        if (quietPollLogs !== undefined && typeof quietPollLogs !== 'boolean') {
          return reply.status(400).send({ error: 'quietPollLogs must be a boolean' })
        }
        if (maskLogUrls !== undefined && typeof maskLogUrls !== 'boolean') {
          return reply.status(400).send({ error: 'maskLogUrls must be a boolean' })
        }
        if (quietPollLogs === undefined && maskLogUrls === undefined) {
          return reply.status(400).send({ error: 'No logging setting supplied' })
        }

        if (quietPollLogs !== undefined) {
          await setSystemSetting(
            QUIET_POLL_LOGS_SETTING,
            quietPollLogs ? 'true' : 'false',
            'Suppress access logs for high-frequency UI poll routes'
          )
          // Apply immediately to the running request-logging hooks.
          await refreshQuietPollState()
        }

        if (maskLogUrls !== undefined) {
          await setSystemSetting(
            MASK_LOG_URLS_SETTING,
            maskLogUrls ? 'true' : 'false',
            'Mask the server hostname and client IPs in access logs'
          )
          await refreshLogMaskingState()
        }

        return reply.send({
          quietPollLogs: (await getSystemSetting(QUIET_POLL_LOGS_SETTING)) === 'true',
          maskLogUrls: (await getSystemSetting(MASK_LOG_URLS_SETTING)) === 'true',
        })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update logging settings')
        return reply.status(500).send({ error: 'Failed to update logging settings' })
      }
    }
  )

  /**
   * GET /api/settings/poster-display
   */
  fastify.get(
    '/api/settings/poster-display',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      try {
        const config = await getPosterDisplayConfig()
        return reply.send(config)
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get poster display config')
        return reply.status(500).send({ error: 'Failed to get poster display configuration' })
      }
    }
  )

  /**
   * PATCH /api/settings/poster-display
   */
  fastify.patch<{ Body: { hideRatingBadgeByDefault?: boolean } }>(
    '/api/settings/poster-display',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const { hideRatingBadgeByDefault } = request.body
        if (hideRatingBadgeByDefault !== undefined && typeof hideRatingBadgeByDefault !== 'boolean') {
          return reply.status(400).send({ error: 'hideRatingBadgeByDefault must be a boolean' })
        }
        const config = await setPosterDisplayConfig({ hideRatingBadgeByDefault })
        return reply.send({ ...config, message: 'Poster display configuration updated' })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update poster display config')
        return reply.status(500).send({ error: 'Failed to update poster display configuration' })
      }
    }
  )
}
