import type { FastifyInstance } from 'fastify'
import {
  getChannelsWebExpandOnSchedule,
  setChannelsWebExpandOnSchedule,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

/**
 * Admin toggle for whether the scheduled channel/collection auto-refresh job also runs
 * Web Search expansion. Manual "Generate" always expands when the Web Search role is set.
 */
export function registerChannelsWebExpandSettingsHandlers(fastify: FastifyInstance) {
  fastify.get(
    '/api/settings/channels-web-expand',
    { preHandler: requireAdmin },
    async (_request, reply) => {
      const onSchedule = await getChannelsWebExpandOnSchedule()
      return reply.send({ webExpandOnSchedule: onSchedule })
    }
  )

  fastify.patch<{
    Body: { webExpandOnSchedule?: boolean }
  }>('/api/settings/channels-web-expand', { preHandler: requireAdmin }, async (request, reply) => {
    const { webExpandOnSchedule } = request.body || {}
    if (webExpandOnSchedule !== undefined) {
      await setChannelsWebExpandOnSchedule(webExpandOnSchedule)
    }
    const onSchedule = await getChannelsWebExpandOnSchedule()
    return reply.send({ webExpandOnSchedule: onSchedule })
  })
}
