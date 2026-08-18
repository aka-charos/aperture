/**
 * fastCRW Retrieval Settings Handlers
 *
 * Endpoints:
 * - GET  /api/settings/crw      - Get config (API key masked)
 * - PUT  /api/settings/crw      - Update config (partial merge)
 * - POST /api/settings/crw/test - Verify the service answers AND that search works
 */
import type { FastifyInstance } from 'fastify'
import {
  checkModeReadiness,
  getCrwConfig,
  isCrwSearchEngine,
  isRetrievalMode,
  sanitizeSearchEngines,
  setCrwConfig,
  setRetrievalMode,
  testCrwConnection,
  type CrwConfig,
  type CrwSearchEngine,
  type RetrievalMode,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

interface CrwUpdateBody {
  enabled?: boolean
  baseUrl?: string
  apiKey?: string
  maxResults?: number
  maxContentChars?: number
  timeoutMs?: number
  sourceBudgetChars?: number
  analysisMaxOutputTokens?: number
  /**
   * Ordered cascade, tried until one answers. See CrwConfig.searchEngines —
   * order is preference, not parallelism.
   */
  searchEngines?: string[]
  /**
   * Where title analysis gets its sources. Lives on this endpoint rather than
   * its own because it decides whether anything else on this card is used at
   * all, and an operator picks the two together.
   */
  retrievalMode?: RetrievalMode
}

/** Config for the client, with the API key omitted (only hasApiKey exposed). */
interface PublicCrwConfig {
  enabled: boolean
  baseUrl: string
  hasApiKey: boolean
  maxResults: number
  maxContentChars: number
  timeoutMs: number
  sourceBudgetChars: number
  analysisMaxOutputTokens: number
  searchEngines: CrwSearchEngine[]
}

function validateConfig(config: CrwConfig): string | null {
  if (config.enabled && !config.baseUrl.trim()) {
    return 'baseUrl is required when the retrieval service is enabled'
  }
  if (config.baseUrl && !/^https?:\/\//i.test(config.baseUrl)) {
    return 'baseUrl must start with http:// or https://'
  }
  if (!Number.isInteger(config.maxResults) || config.maxResults < 1 || config.maxResults > 20) {
    return 'maxResults must be an integer between 1 and 20'
  }
  if (
    !Number.isInteger(config.maxContentChars) ||
    config.maxContentChars < 1000 ||
    config.maxContentChars > 100000
  ) {
    return 'maxContentChars must be an integer between 1000 and 100000'
  }
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 5000 ||
    config.timeoutMs > 300000
  ) {
    return 'timeoutMs must be an integer between 5000 and 300000'
  }
  if (
    !Number.isInteger(config.sourceBudgetChars) ||
    config.sourceBudgetChars < 2000 ||
    config.sourceBudgetChars > 200000
  ) {
    return 'sourceBudgetChars must be an integer between 2000 and 200000'
  }
  // 0 is a real answer here - "send no ceiling" - so it is allowed alongside
  // the range rather than clamped into it.
  if (
    !Number.isInteger(config.analysisMaxOutputTokens) ||
    config.analysisMaxOutputTokens < 0 ||
    (config.analysisMaxOutputTokens > 0 && config.analysisMaxOutputTokens < 512) ||
    config.analysisMaxOutputTokens > 128000
  ) {
    return 'analysisMaxOutputTokens must be 0 (no limit) or an integer between 512 and 128000'
  }
  // Rejected rather than silently dropped: a typo here would leave a shorter
  // cascade than the operator thinks they configured, and the way they would
  // find out is a run failing over to an engine that is not there.
  if (!Array.isArray(config.searchEngines) || config.searchEngines.length === 0) {
    return 'searchEngines must list at least one engine'
  }
  const unknown = config.searchEngines.find((e) => !isCrwSearchEngine(e))
  if (unknown) {
    return `searchEngines contains an unknown engine: ${unknown}`
  }
  return null
}

function toPublicConfig(config: CrwConfig): PublicCrwConfig {
  return {
    enabled: config.enabled,
    // Unlike a key, the base URL is not a secret and IS the thing an operator
    // needs to see to debug a connection — returning it saves them guessing
    // what got saved.
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey.trim(),
    maxResults: config.maxResults,
    maxContentChars: config.maxContentChars,
    timeoutMs: config.timeoutMs,
    sourceBudgetChars: config.sourceBudgetChars,
    analysisMaxOutputTokens: config.analysisMaxOutputTokens,
    searchEngines: config.searchEngines,
  }
}

export function registerCrwHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/settings/crw
   */
  fastify.get(
    '/api/settings/crw',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      try {
        const [config, readiness] = await Promise.all([getCrwConfig(), checkModeReadiness()])
        return reply.send({
          config: { ...toPublicConfig(config), retrievalMode: readiness.mode },
          // Both modes fail identically from a job log — every title erroring —
          // while their fixes are on different settings pages, so the card says
          // which half is missing before anyone runs a batch.
          readiness: { ready: readiness.ready, reason: readiness.reason },
        })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get CRW config')
        return reply.status(500).send({ error: 'Failed to get retrieval configuration' })
      }
    }
  )

  /**
   * PUT /api/settings/crw
   *
   * Partial merge. The API key follows the repo's usual rule and NOT Tavily's:
   * an omitted key means "leave alone", an explicit empty string CLEARS it.
   * Tavily can treat blank as "keep" because a key is mandatory there; here it
   * is optional — most self-hosted deployments run without one — so "keep on
   * blank" would make a key impossible to remove once set.
   */
  fastify.put<{ Body: CrwUpdateBody }>(
    '/api/settings/crw',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const current = await getCrwConfig()
        const body = request.body ?? {}

        const newConfig: CrwConfig = {
          enabled: body.enabled ?? current.enabled,
          baseUrl: body.baseUrl ?? current.baseUrl,
          apiKey: body.apiKey === undefined ? current.apiKey : body.apiKey.trim(),
          maxResults: body.maxResults ?? current.maxResults,
          maxContentChars: body.maxContentChars ?? current.maxContentChars,
          timeoutMs: body.timeoutMs ?? current.timeoutMs,
          sourceBudgetChars: body.sourceBudgetChars ?? current.sourceBudgetChars,
          analysisMaxOutputTokens:
            body.analysisMaxOutputTokens ?? current.analysisMaxOutputTokens,
          // Sanitized before validation so duplicates and casing are fixed
          // quietly, while a genuinely unknown name still fails loudly below.
          searchEngines: body.searchEngines
            ? sanitizeSearchEngines(body.searchEngines)
            : current.searchEngines,
        }

        const validationError = validateConfig(newConfig)
        if (validationError) return reply.status(400).send({ error: validationError })

        if (body.retrievalMode !== undefined) {
          if (!isRetrievalMode(body.retrievalMode)) {
            return reply.status(400).send({ error: 'retrievalMode must be crw or grounding' })
          }
          await setRetrievalMode(body.retrievalMode)
        }

        await setCrwConfig(newConfig)
        const readiness = await checkModeReadiness()
        return reply.send({
          config: { ...toPublicConfig(newConfig), retrievalMode: readiness.mode },
          readiness: { ready: readiness.ready, reason: readiness.reason },
        })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update CRW config')
        return reply.status(500).send({ error: 'Failed to update retrieval configuration' })
      }
    }
  )

  /**
   * POST /api/settings/crw/test
   *
   * Runs a real one-result search. Deliberately not a health ping: the
   * documented failure is running the bare single container, which serves
   * scraping fine while search reports itself disabled — a health check passes
   * on exactly the broken setup this button exists to catch.
   */
  fastify.post<{ Body: { baseUrl?: string; apiKey?: string } }>(
    '/api/settings/crw/test',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const current = await getCrwConfig()
        const provided = request.body ?? {}
        const baseUrl =
          typeof provided.baseUrl === 'string' && provided.baseUrl.trim()
            ? provided.baseUrl.trim()
            : current.baseUrl
        if (!baseUrl) {
          return reply.status(400).send({ error: 'No retrieval service URL configured' })
        }

        const result = await testCrwConnection({
          baseUrl,
          apiKey:
            typeof provided.apiKey === 'string' && provided.apiKey.trim()
              ? provided.apiKey.trim()
              : current.apiKey,
          maxResults: 1,
          maxContentChars: current.maxContentChars,
          timeoutMs: current.timeoutMs,
          // The same cascade the job walks. Testing one engine while the job
          // tries three makes the button lie in both directions.
          engines: current.searchEngines,
        })

        return reply.send(
          result.success
            ? {
                success: true,
                resultCount: result.resultCount ?? 0,
                message: result.message,
                engine: result.engine,
              }
            : { success: false, error: result.message }
        )
      } catch (err) {
        fastify.log.error({ err }, 'Failed to test CRW connection')
        return reply.status(500).send({ error: 'Failed to test the retrieval connection' })
      }
    }
  )
}
