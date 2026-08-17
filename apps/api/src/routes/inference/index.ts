/**
 * Inference / AI spend routes.
 *
 * Reads the `llm_inference_calls` ledger (core `lib/inferenceUsage.ts`) — what
 * the app actually spent, as opposed to what Settings > AI's cost estimator
 * projects it might. Only OpenRouter reports real per-call cost, so the
 * dashboard is scoped to it; `configured` tells the UI whether to render at all.
 *
 * Everything here is admin-only: spend, per-user attribution and conversation
 * titles are all operator-level data.
 */

import type { FastifyPluginAsync } from 'fastify'
import { requireAdmin } from '../../plugins/auth.js'
import {
  getAIConfig,
  getInferenceSummary,
  getInferenceSessions,
  getRecentInferenceCalls,
  getOpenRouterAccountStatus,
  createChildLogger,
  AI_FUNCTIONS,
  type AIFunction,
} from '@aperture/core'

const logger = createChildLogger('inference-routes')

/** The one provider that reports what a call actually cost. */
const LEDGER_PROVIDER = 'openrouter'

const DEFAULT_WINDOW_DAYS = 30

function parseDays(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_DAYS
  return Math.min(365, Math.max(1, parsed))
}

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(1, parsed))
}

/**
 * Which AI roles are pointed at OpenRouter right now. Read off the shared role
 * list, not a copy: `configured` gates the whole dashboard, so a role missing
 * here hides the measured spend of the only role that was spending.
 */
async function getOpenRouterRoles(): Promise<AIFunction[]> {
  const config = await getAIConfig()
  return AI_FUNCTIONS.filter((role) => config[role]?.provider === LEDGER_PROVIDER)
}

const inferenceRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/inference/summary?days=30
   *
   * Totals, daily series and breakdowns, plus OpenRouter's own view of the key.
   * Never 500s on an un-migrated database — the summary degrades to zeroes so
   * the settings page still renders.
   */
  fastify.get<{ Querystring: { days?: string } }>(
    '/api/inference/summary',
    { preHandler: requireAdmin, schema: { tags: ['inference'] } },
    async (request, reply) => {
      try {
        const days = parseDays(request.query.days)
        const roles = await getOpenRouterRoles()

        // The account lookup is a live call to OpenRouter; it must not be able to
        // take the ledger down with it.
        const [summary, account] = await Promise.all([
          getInferenceSummary(LEDGER_PROVIDER, days),
          getOpenRouterAccountStatus().catch(() => null),
        ])

        return reply.send({
          // False means "OpenRouter isn't driving anything" — the panel hides
          // itself rather than showing an empty dashboard for a provider the
          // admin doesn't use.
          configured: roles.length > 0,
          roles,
          account,
          ...summary,
        })
      } catch (err) {
        logger.error({ err }, 'Failed to get inference summary')
        return reply.status(500).send({ error: 'Failed to get inference summary' })
      }
    }
  )

  /**
   * GET /api/inference/calls?limit=50
   */
  fastify.get<{ Querystring: { limit?: string } }>(
    '/api/inference/calls',
    { preHandler: requireAdmin, schema: { tags: ['inference'] } },
    async (request, reply) => {
      try {
        const limit = parseLimit(request.query.limit, 50, 200)
        const calls = await getRecentInferenceCalls(LEDGER_PROVIDER, limit)
        return reply.send({ calls })
      } catch (err) {
        logger.error({ err }, 'Failed to get inference calls')
        return reply.status(500).send({ error: 'Failed to get inference calls' })
      }
    }
  )

  /**
   * GET /api/inference/sessions?days=30&limit=25
   *
   * Spend per assistant conversation. One chat turn can fan out into intent
   * routing, tool calls, discovery structuring and reason enrichment, so the
   * conversation total is the only meaningful "what did that cost".
   */
  fastify.get<{ Querystring: { days?: string; limit?: string } }>(
    '/api/inference/sessions',
    { preHandler: requireAdmin, schema: { tags: ['inference'] } },
    async (request, reply) => {
      try {
        const days = parseDays(request.query.days)
        const limit = parseLimit(request.query.limit, 25, 100)
        const sessions = await getInferenceSessions(LEDGER_PROVIDER, days, limit)
        return reply.send({ sessions })
      } catch (err) {
        logger.error({ err }, 'Failed to get inference sessions')
        return reply.status(500).send({ error: 'Failed to get inference sessions' })
      }
    }
  )
}

export default inferenceRoutes
