/**
 * Decision model settings handlers — the optional evidence judge.
 *
 * Endpoints (all admin):
 * - GET  /api/settings/decision-model         - config (key masked) + readiness
 * - PUT  /api/settings/decision-model         - partial update
 * - POST /api/settings/decision-model/test    - one real call on two fixed pairs
 * - POST /api/settings/decision-model/benchmark - labelled pairs: model vs threshold
 * - GET  /api/settings/decision-model/models  - what the chosen source offers
 * - GET  /api/settings/decision-model/stats   - stored verdicts vs the cosine bar
 * - DELETE /api/settings/decision-model/verdicts - forget every stored verdict
 * - GET  /api/settings/decision-model/labelling - pairs the judges disagree on, to label blind
 * - PUT  /api/settings/decision-model/labels  - record, change or remove one label
 * - GET  /api/settings/decision-model/explanations - written explanations, their checks and labels
 * - PUT  /api/settings/decision-model/explanation-labels - accept, reject, unsure or clear one
 *
 * See core lib/decisionModel.ts and recommender/judgeEvidence.ts.
 */
import type { FastifyInstance } from 'fastify'
import {
  checkDecisionModelReadiness,
  clearEvidenceJudgments,
  getDecisionModelConfig,
  getEvidenceJudgmentStats,
  getLabellingQueue,
  getExplanationQueue,
  isExplanationFilter,
  isExplanationLabel,
  setExplanationLabel,
  ExplanationNotFoundError,
  isEvidenceLabel,
  isLabellingFilter,
  isLabellingMediaType,
  setEvidenceLabel,
  isDecisionModelSource,
  listDecisionModels,
  runEvidenceBenchmark,
  sanitizeDecisionModelConfig,
  setDecisionModelConfig,
  systemOneUrl,
  testEvidenceJudge,
  testSourceFilter,
  DECISION_CONCURRENCY_MAX,
  DECISION_CONCURRENCY_MIN,
  DECISION_TIMEOUT_MAX_MS,
  DECISION_TIMEOUT_MIN_MS,
  MIN_SOURCES_AFTER_JUDGMENT,
  type DecisionModelConfig,
  type DecisionModelSource,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface DecisionModelUpdateBody {
  enabled?: boolean
  filterAnalysisSources?: boolean
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
  filterAnalysisSources: boolean
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
    filterAnalysisSources: config.filterAnalysisSources,
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
  if (body.filterAnalysisSources !== undefined && typeof body.filterAnalysisSources !== 'boolean') {
    return 'filterAnalysisSources must be true or false'
  }
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

/**
 * The settings as they stand on the card, saved or not — what Test and
 * Benchmark run against. One helper so the two cannot differ in how they treat
 * an unsaved URL or a blank key.
 */
async function cardConfig(
  body: DecisionModelUpdateBody
): Promise<{ config: DecisionModelConfig } | { error: string }> {
  const wrongType = typeError(body)
  if (wrongType) return { error: wrongType }
  const current = await getDecisionModelConfig()
  const config = merge(current, { ...body, apiKey: undefined })
  // A key typed on the card is used as typed. A blank one means "the stored
  // key" — but only for the server it was stored for.
  config.apiKey = body.apiKey?.trim() || storedKeyFor(current, config.baseUrl)
  return { config }
}

function merge(current: DecisionModelConfig, body: DecisionModelUpdateBody): DecisionModelConfig {
  return sanitizeDecisionModelConfig({
    enabled: body.enabled ?? current.enabled,
    filterAnalysisSources: body.filterAnalysisSources ?? current.filterAnalysisSources,
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
        return reply.send({ config: toPublicConfig(config), readiness, sourceFilterFloor: MIN_SOURCES_AFTER_JUDGMENT })
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
        return reply.send({ config: toPublicConfig(next), readiness, sourceFilterFloor: MIN_SOURCES_AFTER_JUDGMENT })
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
        const card = await cardConfig(request.body ?? {})
        if ('error' in card) return reply.status(400).send({ success: false, error: card.error })
        const evidence = await testEvidenceJudge(card.config)
        // The source filter sends a DIFFERENT request — one question per
        // document over a sample each, at the size the retrieval settings
        // allow — so the evidence probe says nothing about it. Tried only when
        // the switch is on, since it is a second paid call: `probeFlexTier`'s
        // opt-in rule (F-146), expressed here as "test what is turned on".
        const sourceFilter = card.config.filterAnalysisSources
          ? await testSourceFilter(card.config)
          : undefined
        return reply.send({ ...evidence, ...(sourceFilter ? { sourceFilter } : {}) })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to test decision model')
        return reply.status(500).send({ success: false, error: 'Failed to test the decision model' })
      }
    }
  )

  /**
   * The labelled pairs from the threshold's own derivations, put to the model
   * and to the threshold on this library, scored against the labels. Uses the
   * card as it stands, like Test, and writes nothing.
   */
  fastify.post<{ Body: DecisionModelUpdateBody }>(
    '/api/settings/decision-model/benchmark',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const card = await cardConfig(request.body ?? {})
        if ('error' in card) return reply.status(400).send({ success: false, error: card.error })
        return reply.send(await runEvidenceBenchmark(card.config))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to run the decision model benchmark')
        return reply.status(500).send({ success: false, error: 'Failed to run the benchmark' })
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
   * The pairs the three judges disagree on, for the operator to label blind.
   * Every verdict ships with the item; the card hides them until a label is
   * given, so the client is trusted with the blindness, not with a rule.
   */
  fastify.get<{ Querystring: { filter?: string; offset?: number; limit?: number } }>(
    '/api/settings/decision-model/labelling',
    {
      preHandler: requireAdmin,
      schema: {
        tags: ['settings'],
        querystring: {
          type: 'object',
          properties: {
            filter: { type: 'string' },
            offset: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 0, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const { filter, offset, limit } = request.query
      if (filter !== undefined && !isLabellingFilter(filter)) {
        return reply.status(400).send({ error: 'Unknown filter' })
      }
      try {
        return reply.send(await getLabellingQueue({ filter, offset, limit }))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to read the labelling queue')
        return reply.status(500).send({ error: 'Failed to read the labelling queue' })
      }
    }
  )

  /**
   * Record, change or (label: null) remove one label. Answers with the fresh
   * counts and tallies, so the card updates its score without re-reading a
   * page that would drop the row the operator just labelled.
   */
  fastify.put<{
    Body: { mediaType?: unknown; pickId?: unknown; watchedId?: unknown; label?: unknown }
  }>(
    '/api/settings/decision-model/labels',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      const { mediaType, pickId, watchedId, label } = request.body ?? {}
      if (!isLabellingMediaType(mediaType)) {
        return reply.status(400).send({ error: 'mediaType must be movie or series' })
      }
      if (typeof pickId !== 'string' || !UUID.test(pickId) || typeof watchedId !== 'string' || !UUID.test(watchedId)) {
        return reply.status(400).send({ error: 'pickId and watchedId must be ids' })
      }
      if (label !== null && !isEvidenceLabel(label)) {
        return reply.status(400).send({ error: 'label must be yes, no, arguable or null' })
      }
      try {
        await setEvidenceLabel({ mediaType, pickId, watchedId, label, userId: request.user?.id ?? null })
        const { counts, labelled, arguable, tally, noSharedCreditsTally } = await getLabellingQueue({ limit: 0 })
        return reply.send({ counts, labelled, arguable, tally, noSharedCreditsTally })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to save an evidence label')
        return reply.status(500).send({ error: 'Failed to save the label' })
      }
    }
  )

  /**
   * The written explanations, with the decision model's checks (once the
   * check job has run) and the operator's labels. Blind like the pair queue:
   * the card hides the checks until a label is given.
   */
  fastify.get<{ Querystring: { filter?: string; offset?: number; limit?: number } }>(
    '/api/settings/decision-model/explanations',
    {
      preHandler: requireAdmin,
      schema: {
        tags: ['settings'],
        querystring: {
          type: 'object',
          properties: {
            filter: { type: 'string' },
            offset: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 0, maximum: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const { filter, offset, limit } = request.query
      if (filter !== undefined && !isExplanationFilter(filter)) {
        return reply.status(400).send({ error: 'Unknown filter' })
      }
      try {
        return reply.send(await getExplanationQueue({ filter, offset, limit }))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to read the explanation queue')
        return reply.status(500).send({ error: 'Failed to read the explanations' })
      }
    }
  )

  /**
   * Accept, reject, mark unsure or (label: null) clear one explanation. The
   * text is looked up by its hash server-side, never taken from the request.
   * Answers with the fresh summary, as the pair labels do.
   */
  fastify.put<{ Body: { hash?: unknown; label?: unknown } }>(
    '/api/settings/decision-model/explanation-labels',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      const { hash, label } = request.body ?? {}
      if (typeof hash !== 'string' || !/^[0-9a-f]{40}$/.test(hash)) {
        return reply.status(400).send({ error: 'hash must be an explanation hash' })
      }
      if (label !== null && !isExplanationLabel(label)) {
        return reply.status(400).send({ error: 'label must be accept, reject, unsure or null' })
      }
      try {
        await setExplanationLabel({ hash, label, userId: request.user?.id ?? null })
        const { explanations, checked, flagged, perCheck, counts, agreement } = await getExplanationQueue({
          limit: 0,
        })
        return reply.send({ explanations, checked, flagged, perCheck, counts, agreement })
      } catch (err) {
        if (err instanceof ExplanationNotFoundError) {
          return reply.status(404).send({ error: 'That explanation is no longer on the current recommendations' })
        }
        fastify.log.error({ err }, 'Failed to save an explanation label')
        return reply.status(500).send({ error: 'Failed to save the label' })
      }
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
