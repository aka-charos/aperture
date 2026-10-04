/**
 * Decision model settings handlers — the optional evidence judge.
 *
 * Endpoints (all admin):
 * - GET  /api/settings/decision-model         - config (key masked) + readiness
 * - PUT  /api/settings/decision-model         - partial update
 * - POST /api/settings/decision-model/test    - one real call on two fixed pairs
 * - GET  /api/settings/decision-model/models  - what the chosen source offers
 * - GET  /api/settings/decision-model/stats   - stored verdicts vs the cosine bar
 *
 * See core lib/decisionModel.ts and recommender/judgeEvidence.ts.
 */
import type { FastifyInstance } from 'fastify'
import {
  checkDecisionModelReadiness,
  getDecisionModelConfig,
  getEvidenceJudgmentStats,
  isDecisionModelSource,
  listDecisionModels,
  sanitizeDecisionModelConfig,
  setDecisionModelConfig,
  systemOneUrl,
  testEvidenceJudge,
  DECISION_CONCURRENCY_MAX,
  DECISION_CONCURRENCY_MIN,
  DECISION_TIMEOUT_MAX_MS,
  DECISION_TIMEOUT_MIN_MS,
  type DecisionModelConfig,
  type DecisionModelSource,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

interface DecisionModelUpdateBody {
  enabled?: boolean
  source?: string
  model?: string
  baseUrl?: string
  /** Omitted leaves the stored key alone; an empty string clears it. */
  apiKey?: string
  timeoutMs?: number
  concurrency?: number
}

interface PublicDecisionModelConfig {
  enabled: boolean
  source: DecisionModelSource
  model: string
  baseUrl: string
  hasApiKey: boolean
  timeoutMs: number
  concurrency: number
}

function toPublicConfig(config: DecisionModelConfig): PublicDecisionModelConfig {
  return {
    enabled: config.enabled,
    source: config.source,
    model: config.model,
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
    timeoutMs: config.timeoutMs,
    concurrency: config.concurrency,
  }
}

/**
 * Refused rather than clamped: somebody is asking for these values right now,
 * and silently storing different ones looks like it saved.
 */
function validate(config: DecisionModelConfig, body: DecisionModelUpdateBody): string | null {
  if (body.source !== undefined && !isDecisionModelSource(body.source)) {
    return 'source must be openrouter or custom'
  }
  if (body.model !== undefined && !body.model.trim()) {
    return 'model is required'
  }
  // An alias moves under stored verdicts, and two models' verdicts would then
  // read as one population. OpenRouter marks its aliases with a leading tilde.
  if (config.model.startsWith('~')) {
    return 'Use a versioned model id rather than an alias (for example typesafe/jev-1.13, not ~typesafe/jev-latest)'
  }
  if (config.source === 'custom' && (config.enabled || config.baseUrl) && !systemOneUrl(config.baseUrl)) {
    return 'A self-hosted server needs a base URL starting with http:// or https://'
  }
  if (
    body.timeoutMs !== undefined &&
    (!Number.isInteger(body.timeoutMs) ||
      body.timeoutMs < DECISION_TIMEOUT_MIN_MS ||
      body.timeoutMs > DECISION_TIMEOUT_MAX_MS)
  ) {
    return `timeoutMs must be an integer between ${DECISION_TIMEOUT_MIN_MS} and ${DECISION_TIMEOUT_MAX_MS}`
  }
  if (
    body.concurrency !== undefined &&
    (!Number.isInteger(body.concurrency) ||
      body.concurrency < DECISION_CONCURRENCY_MIN ||
      body.concurrency > DECISION_CONCURRENCY_MAX)
  ) {
    return `concurrency must be an integer between ${DECISION_CONCURRENCY_MIN} and ${DECISION_CONCURRENCY_MAX}`
  }
  return null
}

function merge(current: DecisionModelConfig, body: DecisionModelUpdateBody): DecisionModelConfig {
  return sanitizeDecisionModelConfig({
    enabled: body.enabled ?? current.enabled,
    source: isDecisionModelSource(body.source) ? body.source : current.source,
    model: body.model ?? current.model,
    baseUrl: body.baseUrl ?? current.baseUrl,
    apiKey: body.apiKey === undefined ? current.apiKey : body.apiKey,
    timeoutMs: body.timeoutMs ?? current.timeoutMs,
    concurrency: body.concurrency ?? current.concurrency,
  })
}

export function registerDecisionModelHandlers(fastify: FastifyInstance) {
  fastify.get(
    '/api/settings/decision-model',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      try {
        const config = await getDecisionModelConfig()
        const readiness = await checkDecisionModelReadiness(config)
        return reply.send({ config: toPublicConfig(config), readiness })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get decision model config')
        return reply.status(500).send({ error: 'Failed to get decision model configuration' })
      }
    }
  )

  fastify.put<{ Body: DecisionModelUpdateBody }>(
    '/api/settings/decision-model',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const body = request.body ?? {}
        const next = merge(await getDecisionModelConfig(), body)
        const error = validate(next, body)
        if (error) return reply.status(400).send({ error })

        await setDecisionModelConfig(next)
        const readiness = await checkDecisionModelReadiness(next)
        return reply.send({ config: toPublicConfig(next), readiness })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update decision model config')
        return reply.status(500).send({ error: 'Failed to update decision model configuration' })
      }
    }
  )

  /**
   * Tests what is on the card, saved or not, so an operator can try a model
   * before switching the feature on. A real call on two fixed pairs — a sequel
   * and an unrelated film — because "it answered" passes on a model that
   * answers 0.5 to everything.
   */
  fastify.post<{ Body: DecisionModelUpdateBody }>(
    '/api/settings/decision-model/test',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const body = request.body ?? {}
        const candidate = merge(await getDecisionModelConfig(), {
          ...body,
          // A blank key on the card means "use the stored one" for a test.
          apiKey: body.apiKey ? body.apiKey : undefined,
        })
        return reply.send(await testEvidenceJudge(candidate))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to test decision model')
        return reply.status(500).send({ success: false, error: 'Failed to test the decision model' })
      }
    }
  )

  fastify.get<{ Querystring: { source?: string; baseUrl?: string } }>(
    '/api/settings/decision-model/models',
    {
      preHandler: requireAdmin,
      schema: {
        tags: ['settings'],
        querystring: {
          type: 'object',
          properties: { source: { type: 'string' }, baseUrl: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const current = await getDecisionModelConfig()
        const source = isDecisionModelSource(request.query.source)
          ? request.query.source
          : current.source
        const catalog = await listDecisionModels({
          ...current,
          source,
          baseUrl: request.query.baseUrl ?? current.baseUrl,
        })
        return reply.send(catalog)
      } catch (err) {
        fastify.log.error({ err }, 'Failed to list decision models')
        return reply.status(500).send({ error: 'Failed to list decision models' })
      }
    }
  )

  fastify.get(
    '/api/settings/decision-model/stats',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      return reply.send(await getEvidenceJudgmentStats())
    }
  )
}
