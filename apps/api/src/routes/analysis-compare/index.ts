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
  replayComparison,
  ANALYSIS_PROMPT_VERSION,
  BENCH_PROMPT_VARIANTS,
  BENCH_PROMPT_VERSIONS,
  DRAFT_PROMPT_VERSION,
  getComparisonRun,
  listComparisonRuns,
  deleteComparisonRun,
  cancelComparison,
  MAX_COMPARISON_MODELS,
  getProvidersForFunction,
  getModelsForFunctionWithCustom,
  discoverLocalModels,
  isDiscoverableProvider,
  resolveProviderEndpoint,
  createChildLogger,
  type ComparisonModelRequest,
} from '@aperture/core'

const logger = createChildLogger('analysis-compare-routes')

interface StartBody {
  mediaType?: 'movie' | 'series'
  mediaId?: string
  models?: ComparisonModelRequest[]
  /** Prompt versions to run beside each other; absent means the current one. */
  promptVersions?: number[]
  /** Prompt variants to run beside them; absent means none. */
  promptVariants?: string[]
}

/**
 * A versions or variants field is either absent or an array; what the entries
 * mean is core's to decide (`resolveBenchPromptChoices` refuses an unknown version or
 * variant with a sentence), so only the shape is checked here.
 */
function badVersions(value: unknown): boolean {
  return value !== undefined && !Array.isArray(value)
}

const analysisCompareRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Every model that could hold the Title Analysis role, by provider.
   *
   * The catalogue and a LIVE local probe, because those answer different
   * questions: the catalogue says what this build knows about, and only the
   * probe can say what is actually installed on the server at the other end of
   * a base URL.
   *
   * THE PROBE MUST BE GIVEN THE OPERATOR'S ADDRESS. `discoverLocalModels` takes
   * a base URL and a key precisely because a local server is only reachable
   * where it was configured; called without them it falls back to
   * `localhost:1234`, which inside the API container is the container itself.
   * That shipped, and every local provider reported "did not answer" while LM
   * Studio was running perfectly well on the host.
   *
   * Three states reach the picker, not two. "Not configured", "configured but
   * silent" and "reachable but empty" have three different fixes, and
   * collapsing the first two sends the operator to check an address they never
   * set.
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
            // Bound to a const first: isDiscoverableProvider is a type
            // predicate, and TypeScript carries that narrowing through a const
            // identifier but not through a property access.
            const providerId = provider.id
            const discoverable = isDiscoverableProvider(providerId)
            const endpoint = discoverable
              ? await resolveProviderEndpoint(providerId)
              : { baseUrl: undefined, apiKey: undefined }
            // null means two different things from discoverLocalModels — this
            // provider has no local catalogue to read, or the server did not
            // answer — and only the first is normal. Asking which provider it
            // is separates them, so a cloud provider is never reported as
            // unreachable for lacking something it never had.
            const discovered =
              discoverable && endpoint.baseUrl
                ? await discoverLocalModels(
                    provider.id,
                    'titleAnalysis',
                    endpoint.baseUrl,
                    endpoint.apiKey
                  )
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
              // Only a local provider can be unconfigured or unreachable; a
              // cloud one is neither for having no server of its own.
              configured: discoverable ? Boolean(endpoint.baseUrl) : true,
              reachable: discoverable ? endpoint.baseUrl != null && discovered !== null : true,
              models: [
                ...models.map((model) => ({ id: model.id, name: model.name })),
                ...extra,
              ],
            }
          } catch (err) {
            // One unreachable provider must not empty the whole picker.
            logger.warn({ err, provider: provider.id }, 'Could not list models for a provider')
            return {
              provider: provider.id,
              name: provider.name,
              configured: true,
              reachable: false,
              models: [],
            }
          }
        })
      )

      // The current prompt version rides along as a decided value, so the
      // replay button can name the version it will run without the bundle
      // holding a copy of a number core bumps.
      return reply.send({
        providers: groups,
        maxModels: MAX_COMPARISON_MODELS,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        promptVersions: BENCH_PROMPT_VERSIONS,
        // A draft is benchable only; the picker labels it so nobody mistakes
        // it for the version the library writes with.
        draftPromptVersion: DRAFT_PROMPT_VERSION,
        // Variants are benchable only too, and are never promoted: each is an
        // alternative prompt for one version, offered beside it. The label and
        // the note are decided here so the bundle holds no copy of either.
        promptVariants: BENCH_PROMPT_VARIANTS.map((variant) => ({
          id: variant.id,
          label: variant.label,
          base: variant.base,
          note: variant.note,
        })),
      })
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
      const { mediaType, mediaId, models, promptVersions, promptVariants } = request.body ?? {}

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
      if (badVersions(promptVersions)) {
        return reply.status(400).send({ error: 'promptVersions must be a list of version numbers.' })
      }
      if (badVersions(promptVariants)) {
        return reply.status(400).send({ error: 'promptVariants must be a list of variant ids.' })
      }

      try {
        const runId = await startComparison({
          mediaType,
          mediaId,
          models,
          promptVersions,
          promptVariants,
        })
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

  /**
   * Replay a stored run's documents under the current prompt.
   *
   * Retrieves nothing — see `replayComparison`. The models default to the
   * baseline's, in its order, and the versions to the current one; a body
   * naming either overrides it. 202 for the same reason a fresh bench answers
   * 202.
   */
  fastify.post<{
    Params: { runId: string }
    Body: {
      models?: ComparisonModelRequest[]
      promptVersions?: number[]
      promptVariants?: string[]
    }
  }>(
    '/api/analysis-compare/:runId/replay',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const models = request.body?.models
      const promptVersions = request.body?.promptVersions
      const promptVariants = request.body?.promptVariants
      if (models !== undefined) {
        if (!Array.isArray(models) || models.some((entry) => !entry?.provider || !entry?.model)) {
          return reply.status(400).send({ error: 'Every model needs a provider and a model id.' })
        }
      }
      if (badVersions(promptVersions)) {
        return reply.status(400).send({ error: 'promptVersions must be a list of version numbers.' })
      }
      if (badVersions(promptVariants)) {
        return reply.status(400).send({ error: 'promptVariants must be a list of variant ids.' })
      }

      try {
        const runId = await replayComparison(request.params.runId, {
          models,
          promptVersions,
          promptVariants,
        })
        return reply.status(202).send({ runId })
      } catch (err) {
        // Operator-facing refusals with real sentences, like the start route.
        logger.error({ err }, 'Could not replay a comparison')
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : 'Could not start the replay.' })
      }
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
