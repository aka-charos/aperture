/**
 * LLDAP Integration Settings Handlers
 *
 * Endpoints:
 * - GET /api/settings/lldap - Get LLDAP config
 * - PATCH /api/settings/lldap - Update LLDAP config
 * - POST /api/settings/lldap/test - Test LLDAP connection
 *
 * The actual email import runs as the `sync-lldap-emails` background job
 * (Admin → Jobs), same as every other scheduled sync in this app — there's no
 * bespoke "sync now" endpoint here.
 */
import type { FastifyInstance } from 'fastify'
import { getLldapConfig, setLldapConfig, getLldapAdminPassword, testLldapConnection } from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'
import { lldapConfigSchema, updateLldapConfigSchema, testLldapSchema } from '../schemas.js'

export function registerLldapHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/settings/lldap
   */
  fastify.get('/api/settings/lldap', { preHandler: requireAdmin, schema: lldapConfigSchema }, async (_request, reply) => {
    try {
      const config = await getLldapConfig()
      return reply.send(config)
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get LLDAP config')
      return reply.status(500).send({ error: 'Failed to get LLDAP configuration' })
    }
  })

  /**
   * PATCH /api/settings/lldap
   */
  fastify.patch<{
    Body: { url?: string; adminUsername?: string; adminPassword?: string; enabled?: boolean }
  }>('/api/settings/lldap', { preHandler: requireAdmin, schema: updateLldapConfigSchema }, async (request, reply) => {
    try {
      const { url, adminUsername, adminPassword, enabled } = request.body

      const config = await setLldapConfig({ url, adminUsername, adminPassword, enabled })

      return reply.send({ ...config, message: 'LLDAP configuration updated' })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to save LLDAP config')
      return reply.status(500).send({ error: 'Failed to save LLDAP configuration' })
    }
  })

  /**
   * POST /api/settings/lldap/test
   */
  fastify.post<{
    Body?: { url?: string; adminUsername?: string; adminPassword?: string }
  }>('/api/settings/lldap/test', { preHandler: requireAdmin, schema: testLldapSchema }, async (request, reply) => {
    try {
      const saved = await getLldapConfig()
      const url = request.body?.url || saved.url
      const adminUsername = request.body?.adminUsername || saved.adminUsername
      const adminPassword = request.body?.adminPassword || (await getLldapAdminPassword())

      if (!url || !adminUsername || !adminPassword) {
        return reply.send({
          success: false,
          error: 'Server URL, admin username, and admin password are all required',
        })
      }

      const result = await testLldapConnection({ url, adminUsername, adminPassword })
      return reply.send(result)
    } catch (err) {
      fastify.log.error({ err }, 'Failed to test LLDAP connection')
      return reply.status(500).send({ error: 'Failed to test LLDAP connection' })
    }
  })
}
