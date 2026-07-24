/**
 * Tavily Integration Settings Handlers
 *
 * Endpoints:
 * - GET  /api/settings/tavily      - Get Tavily config (API key masked)
 * - PUT  /api/settings/tavily      - Update Tavily config (partial merge)
 * - POST /api/settings/tavily/test - Test the API key + params with a sample search
 */
import type { FastifyInstance } from 'fastify'
import {
  getTavilyConfig,
  setTavilyConfig,
  tavilySearch,
  type TavilyConfig,
  type TavilySearchDepth,
  type TavilyTopic,
  type TavilyTimeRange,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

const SEARCH_DEPTHS: TavilySearchDepth[] = ['basic', 'advanced']
const TOPICS: TavilyTopic[] = ['general', 'news']
const TIME_RANGES: Exclude<TavilyTimeRange, null>[] = ['day', 'week', 'month', 'year']

interface TavilyUpdateBody {
  enabled?: boolean
  apiKey?: string
  maxResults?: number
  searchDepth?: TavilySearchDepth
  includeAnswer?: boolean
  topic?: TavilyTopic
  timeRange?: TavilyTimeRange | ''
  maxContentChars?: number
}

/** Config for the client, with the API key omitted (only hasApiKey exposed). */
interface PublicTavilyConfig {
  enabled: boolean
  hasApiKey: boolean
  maxResults: number
  searchDepth: TavilySearchDepth
  includeAnswer: boolean
  topic: TavilyTopic
  timeRange: TavilyTimeRange
  maxContentChars: number
}

/** Coerce a possibly-empty timeRange ('' from a "None" select) to null. */
function normalizeTimeRange(
  value: TavilyTimeRange | '' | undefined,
  fallback: TavilyTimeRange
): TavilyTimeRange {
  if (value === undefined) return fallback
  if (value === '' || value === null) return null
  return value
}

function validateConfig(config: TavilyConfig): string | null {
  if (!Number.isInteger(config.maxResults) || config.maxResults < 1 || config.maxResults > 20) {
    return 'maxResults must be an integer between 1 and 20'
  }
  if (
    !Number.isInteger(config.maxContentChars) ||
    config.maxContentChars < 100 ||
    config.maxContentChars > 8000
  ) {
    return 'maxContentChars must be an integer between 100 and 8000'
  }
  if (!SEARCH_DEPTHS.includes(config.searchDepth)) return 'searchDepth must be basic or advanced'
  if (!TOPICS.includes(config.topic)) return 'topic must be general or news'
  if (config.timeRange !== null && !TIME_RANGES.includes(config.timeRange)) {
    return 'timeRange must be day, week, month, year, or empty'
  }
  return null
}

function toPublicConfig(config: TavilyConfig): PublicTavilyConfig {
  return {
    enabled: config.enabled,
    hasApiKey: !!config.apiKey.trim(),
    maxResults: config.maxResults,
    searchDepth: config.searchDepth,
    includeAnswer: config.includeAnswer,
    topic: config.topic,
    timeRange: config.timeRange,
    maxContentChars: config.maxContentChars,
  }
}

export function registerTavilyHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/settings/tavily
   */
  fastify.get(
    '/api/settings/tavily',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      try {
        const config = await getTavilyConfig()
        return reply.send({ config: toPublicConfig(config) })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get Tavily config')
        return reply.status(500).send({ error: 'Failed to get Tavily configuration' })
      }
    }
  )

  /**
   * PUT /api/settings/tavily
   * Partial merge — a blank/omitted apiKey keeps the stored key.
   */
  fastify.put<{ Body: TavilyUpdateBody }>(
    '/api/settings/tavily',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const current = await getTavilyConfig()
        const body = request.body ?? {}
        const apiKeyProvided = typeof body.apiKey === 'string' && body.apiKey.trim().length > 0
        const nextApiKey = apiKeyProvided ? (body.apiKey as string).trim() : current.apiKey

        const newConfig: TavilyConfig = {
          enabled: body.enabled ?? current.enabled,
          apiKey: nextApiKey,
          maxResults: body.maxResults ?? current.maxResults,
          searchDepth: body.searchDepth ?? current.searchDepth,
          includeAnswer: body.includeAnswer ?? current.includeAnswer,
          topic: body.topic ?? current.topic,
          timeRange: normalizeTimeRange(body.timeRange, current.timeRange),
          maxContentChars: body.maxContentChars ?? current.maxContentChars,
        }

        const validationError = validateConfig(newConfig)
        if (validationError) return reply.status(400).send({ error: validationError })

        await setTavilyConfig(newConfig)
        return reply.send({ config: toPublicConfig(newConfig) })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update Tavily config')
        return reply.status(500).send({ error: 'Failed to update Tavily configuration' })
      }
    }
  )

  /**
   * POST /api/settings/tavily/test
   * Runs a sample search with the provided key (or the saved one) to verify it.
   */
  fastify.post<{ Body: { apiKey?: string } }>(
    '/api/settings/tavily/test',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const current = await getTavilyConfig()
        const provided = request.body?.apiKey
        const apiKey =
          typeof provided === 'string' && provided.trim() ? provided.trim() : current.apiKey
        if (!apiKey) {
          return reply.status(400).send({ error: 'No Tavily API key configured' })
        }

        try {
          const res = await tavilySearch('movies similar to The Matrix', {
            apiKey,
            maxResults: 3,
            searchDepth: current.searchDepth,
            includeAnswer: current.includeAnswer,
            topic: current.topic,
          })
          return reply.send({ success: true, resultCount: res.results.length, hasAnswer: !!res.answer })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return reply.send({ success: false, error: message })
        }
      } catch (err) {
        fastify.log.error({ err }, 'Failed to test Tavily connection')
        return reply.status(500).send({ error: 'Failed to test Tavily connection' })
      }
    }
  )
}
