/**
 * Decision model settings handlers — the optional evidence judge.
 *
 * Endpoints (all admin):
 * - GET  /api/settings/decision-model         - config (key masked) + readiness
 * - PUT  /api/settings/decision-model         - partial update
 * - POST /api/settings/decision-model/test    - one real call on two fixed pairs
 * - GET  /api/settings/decision-model/models  - what the chosen source offers
 * - GET  /api/settings/decision-model/stats   - stored verdicts vs the cosine bar
 * - DELETE /api/settings/decision-model/verdicts - forget every stored verdict
 *
 * See core lib/decisionModel.ts and recommender/judgeEvidence.ts.
 */
import type { FastifyInstance } from 'fastify'
import {
  checkDecisionModelReadiness,
  clearEvidenceJudgments,
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
 * The body has no JSON schema, so a field can arrive as anything. A wrong type
 * is refused here, before merge() would quietly coerce it (a string "true" for
 * `enabled` reads as off) or a `.trim()` on a number throws a 500.
 */
function typeError(body: DecisionModelUpdateBody): string | null {
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return 'enabled must be true or false'
  for (const key of ['source', 'model', 'baseUrl', 'apiKey'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') return `${key} must be a string`
  }
  for (const key of ['timeoutMs', 'concurrency'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'number') return `${key} must be a number`
  }
  return null
}

/**
 * Refused rather than clamped: somebody is asking for these values right now,
 * and silently storing different ones looks like it saved.
 */
function validate(config: DecisionModelConfig, body: DecisionModelUpdateBody): string | null {
  const wrongType = typeError(body)
  if (wrongType) return wrongType
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

/**
 * The stored self-hosted key, but only for the server it was saved for.
 *
 * Test and the model list accept a URL that is not saved yet, so the card can
 * try a server before committing to it. Sending the stored key along to that
 * URL would hand the key to whatever answers there — and the model list is a
 * GET, which a SameSite=lax session cookie carries on a plain link, so one
 * crafted link clicked by an admin would be enough. A different URL gets the
 * key typed on the card, or none.
 */
function storedKeyFor(current: DecisionModelConfig, baseUrl: string): string {
  const target = systemOneUrl(baseUrl)
  return target !== null && target === systemOneUrl(current.baseUrl) ? current.apiKey : ''
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
        const wrongType = typeError(body)
        if (wrongType) return reply.status(400).send({ success: false, error: wrongType })

        const current = await getDecisionModelConfig()
        const candidate = merge(current, { ...body, apiKey: undefined })
        // A key typed on the card is used as typed. A blank one means "the
        // stored key" — but only for the server it was stored for.
        candidate.apiKey = body.apiKey?.trim() || storedKeyFor(current, candidate.baseUrl)
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
        const baseUrl = request.query.baseUrl ?? current.baseUrl
        const catalog = await listDecisionModels({
          ...current,
          source,
          baseUrl,
          apiKey: storedKeyFor(current, baseUrl),
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

  /**
   * Forget every stored verdict: the way back, and the step before comparing
   * a second model. See clearEvidenceJudgments.
   */
  fastify.delete(
    '/api/settings/decision-model/verdicts',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      try {
        const cleared = await clearEvidenceJudgments()
        return reply.send({ cleared })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to clear decision model verdicts')
        return reply.status(500).send({ error: 'Failed to clear stored verdicts' })
      }
    }
  )
}
