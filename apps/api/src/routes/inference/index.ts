/**
 * Inference / AI spend routes.
 *
 * Reads the `llm_inference_calls` ledger (core `lib/inferenceUsage.ts`) — what
 * the app actually spent, as opposed to what Settings > AI's cost estimator
 * projects it might.
 *
 * The scope is `METERED_PROVIDERS`: every provider with an instrumented fetch,
 * which today is OpenRouter and Z.AI. Their money is not the same KIND of
 * number — OpenRouter reports the credits it charged, Z.AI reports tokens that
 * are priced here from its published catalog — so the summary ships
 * `estimatedProviders` and the panel says which rows are estimates. Pooling them
 * into one unlabelled total would be the thing this dashboard exists not to do.
 *
 * `configured` tells the UI whether to render at all: no role pointed at a
 * metered provider means there is nothing to measure, not an empty week.
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
  METERED_PROVIDERS,
  type AIFunction,
} from '@aperture/core'

const logger = createChildLogger('inference-routes')

/** The providers whose calls reach the ledger. Ordered as the dashboard lists them. */
const LEDGER_PROVIDERS: readonly string[] = METERED_PROVIDERS

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

interface ConfiguredProviders {
  /** Roles pointed at any metered provider, in role order. */
  roles: AIFunction[]
  /** The distinct metered providers those roles use. */
  providers: string[]
}

/**
 * Which AI roles are pointed at a metered provider right now.
 *
 * Read off the shared role list, not a copy: `configured` gates the whole
 * dashboard, so a role missing here hides the measured spend of the only role
 * that was spending.
 *
 * The provider set is returned alongside because the OpenRouter account lookup
 * is a live HTTP call and must not be made for an instance that has never used
 * OpenRouter.
 */
async function getMeteredRoles(): Promise<ConfiguredProviders> {
  const config = await getAIConfig()
  const roles = AI_FUNCTIONS.filter((role) => {
    const provider = config[role]?.provider
    return provider != null && LEDGER_PROVIDERS.includes(provider)
  })
  const providers = [
    ...new Set(
      roles.flatMap((role) => {
        const provider = config[role]?.provider
        return provider ? [String(provider)] : []
      })
    ),
  ]
  return { roles, providers }
}

const inferenceRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/inference/summary?days=30
   *
   * Totals, daily series and breakdowns across every metered provider, plus
   * OpenRouter's own view of the key when OpenRouter is one of them. Never 500s
   * on an un-migrated database — the summary degrades to zeroes so the settings
   * page still renders.
   */
  fastify.get<{ Querystring: { days?: string } }>(
    '/api/inference/summary',
    { preHandler: requireAdmin, schema: { tags: ['inference'] } },
    async (request, reply) => {
      try {
        const days = parseDays(request.query.days)
        const { roles, providers } = await getMeteredRoles()

        // The account lookup is a live call to OpenRouter; it must not be able to
        // take the ledger down with it, and it is skipped entirely for an
        // instance that does not use OpenRouter rather than returning null after
        // a pointless round trip.
        const [summary, account] = await Promise.all([
          getInferenceSummary(LEDGER_PROVIDERS, days),
          providers.includes('openrouter')
            ? getOpenRouterAccountStatus().catch(() => null)
            : Promise.resolve(null),
        ])

        return reply.send({
          // False means "no metered provider is driving anything" — the panel
          // hides itself rather than showing an empty dashboard for providers
          // the admin doesn't use.
          configured: roles.length > 0,
          roles,
          // The metered providers actually in use, as distinct from the window's
          // `providers`, which is everything the ledger was read for.
          configuredProviders: providers,
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
        const calls = await getRecentInferenceCalls(LEDGER_PROVIDERS, limit)
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
        const sessions = await getInferenceSessions(LEDGER_PROVIDERS, days, limit)
        return reply.send({ sessions })
      } catch (err) {
        logger.error({ err }, 'Failed to get inference sessions')
        return reply.status(500).send({ error: 'Failed to get inference sessions' })
      }
    }
  )
}

export default inferenceRoutes
