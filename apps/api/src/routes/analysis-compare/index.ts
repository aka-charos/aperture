/**
 * The title-analysis model bench.
 *
 * Its own namespace rather than `/api/analysis/compare/*`, deliberately: the
 * analysis routes already own `/api/analysis/:mediaType/:id`, and a static
 * `compare` segment sitting beside a parameter that a schema constrains to
 * `movie|series` is the kind of collision that resolves correctly today and
 * confusingly the first time either route grows a segment.
 *
 * ADMIN ONLY, and not because the output is sensitive — a bench spends real
 * model calls on however many models are ticked, and a local entry can run for
 * the better part of an hour.
 *
 * There is no search endpoint here: the title picker uses the existing
 * `GET /api/search`, which already ranks movies and series together.
 */
import type { FastifyPluginAsync } from 'fastify'
import { requireAdmin } from '../../plugins/auth.js'
import {
  startComparison,
  getComparisonRun,
  listComparisonRuns,
  deleteComparisonRun,
  cancelComparison,
  MAX_COMPARISON_MODELS,
  getProvidersForFunction,
  getModelsForFunctionWithCustom,
  discoverLocalModels,
  isDiscoverableProvider,
  createChildLogger,
  type ComparisonModelRequest,
} from '@aperture/core'

const logger = createChildLogger('analysis-compare-routes')

interface StartBody {
  mediaType?: 'movie' | 'series'
  mediaId?: string
  models?: ComparisonModelRequest[]
}

const analysisCompareRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Every model that could hold the Title Analysis role, by provider.
   *
   * The catalogue and a LIVE local probe, because those answer different
   * questions: the catalogue says what this build knows about, and only the
   * probe can say what is actually installed on the server at the other end of
   * a base URL. `reachable: false` is passed through rather than flattened to an
   * empty list — "nothing installed" and "wrong address" look identical in a
   * picker and have opposite fixes.
   */
  fastify.get(
    '/api/analysis-compare/models',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (_request, reply) => {
      const providers = getProvidersForFunction('titleAnalysis')

      const groups = await Promise.all(
        providers.map(async (provider) => {
          try {
            const models = await getModelsForFunctionWithCustom(provider.id, 'titleAnalysis')
            // null means two different things from discoverLocalModels — this
            // provider has no local catalog to read, or the server did not
            // answer — and only the first is normal. Asking which provider it
            // is separates them, so a cloud provider is never reported as
            // unreachable for lacking something it never had.
            const discoverable = isDiscoverableProvider(provider.id)
            const discovered = discoverable
              ? await discoverLocalModels(provider.id, 'titleAnalysis')
              : null

            // A discovered id the catalogue already lists must not appear
            // twice; the catalogue entry wins because it carries the name and
            // the capability flags.
            const known = new Set(models.map((model) => model.id))
            const extra = (discovered?.models ?? [])
              .filter((model) => !known.has(model.id))
              .map((model) => ({ id: model.id, name: model.name ?? model.id }))

            return {
              provider: provider.id,
              name: provider.name,
              reachable: discoverable ? discovered !== null : true,
              models: [
                ...models.map((model) => ({ id: model.id, name: model.name })),
                ...extra,
              ],
            }
          } catch (err) {
            // One unreachable provider must not empty the whole picker.
            logger.warn({ err, provider: provider.id }, 'Could not list models for a provider')
            return { provider: provider.id, name: provider.name, reachable: false, models: [] }
          }
        })
      )

      return reply.send({ providers: groups, maxModels: MAX_COMPARISON_MODELS })
    }
  )

  fastify.get(
    '/api/analysis-compare/runs',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (_request, reply) => {
      return reply.send({ runs: await listComparisonRuns() })
    }
  )

  /**
   * Start a bench.
   *
   * Answers **202 with the run id and nothing else**, because retrieval plus
   * six models is minutes at best and most of an hour with a local entry — the
   * same reason the discovery refresh does not hold its request open. The page
   * polls the run and watches entries fill in.
   */
  fastify.post<{ Body: StartBody }>(
    '/api/analysis-compare',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const { mediaType, mediaId, models } = request.body ?? {}

      if (mediaType !== 'movie' && mediaType !== 'series') {
        return reply.status(400).send({ error: 'mediaType must be "movie" or "series".' })
      }
      if (!mediaId) {
        return reply.status(400).send({ error: 'Pick a title.' })
      }
      if (!Array.isArray(models) || models.length === 0) {
        return reply.status(400).send({ error: 'Pick at least one model.' })
      }
      if (models.some((entry) => !entry?.provider || !entry?.model)) {
        return reply.status(400).send({ error: 'Every model needs a provider and a model id.' })
      }

      try {
        const runId = await startComparison({ mediaType, mediaId, models })
        return reply.status(202).send({ runId })
      } catch (err) {
        // These are all operator-facing refusals with real sentences — the
        // wrong retrieval mode, an unconfigured provider, a title that is not
        // in the library — so the message is passed through rather than
        // replaced by a generic 500. See seerrCall's rule.
        logger.error({ err }, 'Could not start a comparison')
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : 'Could not start the comparison.' })
      }
    }
  )

  fastify.get<{ Params: { runId: string } }>(
    '/api/analysis-compare/:runId',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const run = await getComparisonRun(request.params.runId)
      if (!run) return reply.status(404).send({ error: 'No such comparison.' })
      return reply.send(run)
    }
  )

  fastify.post<{ Params: { runId: string } }>(
    '/api/analysis-compare/:runId/cancel',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      // Cooperative, like every other cancel here: the flag is polled between
      // models and inside the write attempt, so a model already generating
      // finishes its call before the run stops.
      const stopping = cancelComparison(request.params.runId)
      return reply.send({ stopping })
    }
  )

  fastify.delete<{ Params: { runId: string } }>(
    '/api/analysis-compare/:runId',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      await deleteComparisonRun(request.params.runId)
      return reply.send({ deleted: true })
    }
  )
}

export default analysisCompareRoutes
