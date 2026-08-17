/**
 * Grounded per-title analysis routes.
 *
 * GET is cheap and cached; POST spends a grounded request against a hard daily
 * cap, which is why generation is a BUTTON rather than something a page load
 * triggers. Two reasons, and they compound:
 *
 *  - Quota. Grounded search is capped per day per Google project. Analysing
 *    only what someone actually asks about targets that budget at what gets
 *    read, and the human clicking is a better filter than any heuristic we
 *    could write for "is this film worth analysing".
 *  - Latency. A grounded call takes tens of seconds. Behind a button that is an
 *    opted-in wait; on page load it is a broken-looking page.
 */

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../plugins/auth.js'
import {
  analyseTitle,
  getStoredAnalysis,
  loadAnalysisSubject,
  createChildLogger,
  type StoredAnalysis,
} from '@aperture/core'

const logger = createChildLogger('analysis-routes')

function parseMediaType(raw: string): 'movie' | 'series' | null {
  return raw === 'movie' || raw === 'series' ? raw : null
}

/**
 * In-flight generations, keyed by media type + id.
 *
 * Single-flight, and it is not merely an optimisation: without it a
 * double-clicked button or two users opening the same detail page spend two
 * grounded requests to produce one row, against a budget where each request is
 * scarce. Callers join the existing promise instead.
 *
 * Process-local, deliberately. A cross-process lock would need the database and
 * a lease; the failure it would prevent — two API instances analysing the same
 * title in the same few seconds — costs exactly one duplicate request, which is
 * not worth that machinery.
 */
const inFlight = new Map<string, Promise<StoredAnalysis>>()

const analysisRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/analysis/:mediaType/:id
   *
   * Returns the cached analysis, or `{ analysis: null, attempted: false }` when
   * nothing has been generated yet. Never generates — the three states a client
   * must distinguish are "have one", "asked and declined", and "never asked",
   * and only the last offers a button.
   */
  fastify.get<{ Params: { mediaType: string; id: string } }>(
    '/api/analysis/:mediaType/:id',
    { preHandler: requireAuth, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const mediaType = parseMediaType(request.params.mediaType)
      if (!mediaType) return reply.status(400).send({ error: 'Invalid media type' })

      try {
        const stored = await getStoredAnalysis(mediaType, request.params.id)
        if (!stored) {
          return reply.send({ attempted: false, analysis: null })
        }
        return reply.send({
          attempted: true,
          analysis: stored.analysis,
          declineReason: stored.declineReason,
          sources: stored.sources,
          sourceGrade: stored.sourceGrade,
          analyzedAt: stored.analyzedAt,
          generating: inFlight.has(`${mediaType}:${request.params.id}`),
        })
      } catch (err) {
        logger.error({ err, mediaType, id: request.params.id }, 'Failed to read title analysis')
        return reply.status(500).send({ error: 'Failed to read analysis' })
      }
    }
  )

  /**
   * POST /api/analysis/:mediaType/:id
   *
   * Generate on demand. Cache-first: a title that already has a current
   * analysis returns it without spending anything, so a stale client cannot
   * burn quota by retrying.
   *
   * Not admin-only. Spend is bounded by the provider's own daily cap and by
   * single-flight, and the people who want an analysis are the people reading
   * the page; requiring an admin would mean nobody ever gets one.
   */
  fastify.post<{ Params: { mediaType: string; id: string }; Querystring: { force?: string } }>(
    '/api/analysis/:mediaType/:id',
    { preHandler: requireAuth, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const mediaType = parseMediaType(request.params.mediaType)
      if (!mediaType) return reply.status(400).send({ error: 'Invalid media type' })

      const { id } = request.params
      const key = `${mediaType}:${id}`

      try {
        const existing = await getStoredAnalysis(mediaType, id)
        // A stored decline counts as an answer: re-asking spends a grounded
        // request to receive the same "there is nothing to say" every time.
        // Bumping ANALYSIS_PROMPT_VERSION is what clears those deliberately.
        if (existing) {
          return reply.send({
            attempted: true,
            analysis: existing.analysis,
            declineReason: existing.declineReason,
            sources: existing.sources,
            sourceGrade: existing.sourceGrade,
            analyzedAt: existing.analyzedAt,
            generated: false,
          })
        }

        const running = inFlight.get(key)
        if (running) {
          const joined = await running
          return reply.send({
            attempted: true,
            analysis: joined.analysis,
            declineReason: joined.declineReason,
            sources: joined.sources,
            sourceGrade: joined.sourceGrade,
            analyzedAt: joined.analyzedAt,
            generated: false,
          })
        }

        const subject = await loadAnalysisSubject(mediaType, id)
        if (!subject) return reply.status(404).send({ error: 'Title not found' })

        const work = analyseTitle(mediaType, id, subject).finally(() => inFlight.delete(key))
        inFlight.set(key, work)

        const result = await work
        return reply.send({
          attempted: true,
          analysis: result.analysis,
          declineReason: result.declineReason,
          sources: result.sources,
          sourceGrade: result.sourceGrade,
          analyzedAt: result.analyzedAt,
          generated: true,
        })
      } catch (err) {
        // A failure writes no row, so the title stays pending and both this
        // button and the batch job will try again. Surfaced as 503 rather than
        // 500: the usual causes are the retrieval service being unreachable or
        // its upstream search engines throttling, both temporary and neither
        // the caller's fault.
        logger.warn({ err, mediaType, id }, 'Title analysis generation failed')
        const message = err instanceof Error ? err.message : 'Analysis failed'
        const unconfigured = /is not configured/i.test(message)
        return reply.status(unconfigured ? 400 : 503).send({
          error: unconfigured
            ? 'Title Analysis is not configured. Set it up in Settings > AI.'
            : 'Analysis is unavailable right now. This is usually the daily search quota; it resets overnight.',
        })
      }
    }
  )
}

export default analysisRoutes
