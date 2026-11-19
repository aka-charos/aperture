import type { FastifyInstance } from 'fastify'
import { getNextSummarySizeLimits, setNextSummarySize } from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

const LIMITS_RESPONSE = {
  type: 'object',
  properties: {
    value: { type: 'integer' },
    default: { type: 'integer' },
    min: { type: 'integer' },
    max: { type: 'integer' },
  },
} as const

/**
 * How many suggestions a title's own page shows (Next from here). The limits
 * travel with the value, decided in core (`nextFromHere/summarySize.ts`), so
 * the console holds no copy of them; a value outside them is refused, never
 * clamped.
 */
export function registerNextFromHereSettingsHandlers(fastify: FastifyInstance) {
  fastify.get(
    '/api/settings/next-from-here',
    {
      preHandler: requireAdmin,
      schema: {
        tags: ['settings'],
        summary: "Suggestions shown on a title's page",
        response: { 200: LIMITS_RESPONSE },
      },
    },
    async () => getNextSummarySizeLimits()
  )

  fastify.patch<{ Body: { summarySize: number } }>(
    '/api/settings/next-from-here',
    {
      preHandler: requireAdmin,
      schema: {
        tags: ['settings'],
        summary: "Set how many suggestions a title's page shows",
        body: {
          type: 'object',
          required: ['summarySize'],
          properties: { summarySize: { type: 'integer' } },
        },
        response: { 200: LIMITS_RESPONSE },
      },
    },
    async (request, reply) => {
      try {
        await setNextSummarySize(request.body.summarySize)
      } catch (err) {
        if (err instanceof RangeError) return reply.status(400).send({ error: err.message })
        throw err
      }
      return getNextSummarySizeLimits()
    }
  )
}
