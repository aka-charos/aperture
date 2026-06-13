/**
 * n8n Integration Settings Handlers
 *
 * Endpoints:
 * - GET /api/settings/n8n - Get n8n integration config
 * - PUT /api/settings/n8n - Update n8n integration config
 * - POST /api/settings/n8n/test - Test a webhook (search tool or pre-process)
 */
import type { FastifyInstance } from 'fastify'
import {
  getN8nConfig,
  setN8nConfig,
  callN8nWebhook,
  type N8nIntegrationConfig,
  type N8nWebhookConfig,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

function validateWebhook(name: string, webhook: N8nWebhookConfig | null): string | null {
  if (!webhook) return null
  if (webhook.enabled) {
    if (!webhook.webhookUrl || !/^https?:\/\//.test(webhook.webhookUrl)) {
      return `${name}: webhookUrl must be a valid http(s) URL when enabled`
    }
  }
  if (webhook.timeoutMs !== undefined && (webhook.timeoutMs < 1000 || webhook.timeoutMs > 120000)) {
    return `${name}: timeoutMs must be between 1000 and 120000`
  }
  return null
}

/** Realistic sample payloads so a test exercises the same path as real calls */
const TEST_PAYLOADS: Record<keyof N8nIntegrationConfig, unknown> = {
  searchTool: { type: 'search', query: 'connectivity test', maxResults: 1 },
  preProcess: {
    type: 'preProcess',
    userId: 'test',
    isAdmin: true,
    messages: [{ id: 'test', role: 'user', parts: [{ type: 'text', text: 'connectivity test' }] }],
  },
}

export function registerN8nHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/settings/n8n
   */
  fastify.get('/api/settings/n8n', { preHandler: requireAdmin, schema: { tags: ['settings'] } }, async (_request, reply) => {
    try {
      const config = await getN8nConfig()
      return reply.send({ config })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get n8n config')
      return reply.status(500).send({ error: 'Failed to get n8n configuration' })
    }
  })

  /**
   * PUT /api/settings/n8n
   */
  fastify.put<{
    Body: {
      searchTool?: N8nWebhookConfig | null
      preProcess?: N8nWebhookConfig | null
    }
  }>('/api/settings/n8n', { preHandler: requireAdmin, schema: { tags: ['settings'] } }, async (request, reply) => {
    try {
      const currentConfig = await getN8nConfig()
      const updates = request.body

      const newConfig: N8nIntegrationConfig = {
        searchTool: updates.searchTool !== undefined ? updates.searchTool : currentConfig.searchTool,
        preProcess: updates.preProcess !== undefined ? updates.preProcess : currentConfig.preProcess,
      }

      const validationError =
        validateWebhook('searchTool', newConfig.searchTool) ??
        validateWebhook('preProcess', newConfig.preProcess)
      if (validationError) {
        return reply.status(400).send({ error: validationError })
      }

      await setN8nConfig(newConfig)
      return reply.send({ config: newConfig })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to update n8n config')
      return reply.status(500).send({ error: 'Failed to update n8n configuration' })
    }
  })

  /**
   * POST /api/settings/n8n/test
   * Tests the given webhook config (or the saved one if none provided).
   */
  fastify.post<{
    Body: {
      target: 'searchTool' | 'preProcess'
      config?: N8nWebhookConfig
    }
  }>('/api/settings/n8n/test', { preHandler: requireAdmin, schema: { tags: ['settings'] } }, async (request, reply) => {
    try {
      const { target, config } = request.body

      if (target !== 'searchTool' && target !== 'preProcess') {
        return reply.status(400).send({ error: 'target must be searchTool or preProcess' })
      }

      const webhook = config ?? (await getN8nConfig())[target]
      if (!webhook?.webhookUrl) {
        return reply.status(400).send({ error: 'No webhook URL configured for this target' })
      }

      try {
        const result = await callN8nWebhook(webhook, TEST_PAYLOADS[target])
        return reply.send({ success: true, response: result })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return reply.send({ success: false, error: message })
      }
    } catch (err) {
      fastify.log.error({ err }, 'Failed to test n8n webhook')
      return reply.status(500).send({ error: 'Failed to test n8n webhook' })
    }
  })
}
