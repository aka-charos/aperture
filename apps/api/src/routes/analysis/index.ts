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
  isAnalysisStale,
  loadAnalysisSubject,
  createChildLogger,
  describeAiError,
  type StoredAnalysis,
} from '@aperture/core'

/**
 * The wire shape, in one place because GET and POST both send it and the
 * client branches on all of it.
 *
 * `stale` is computed here rather than shipping `promptVersion` to the
 * browser: the current version is a server-side constant, and a client that
 * compared numbers itself would need to be redeployed in lockstep with every
 * prompt change to stay right.
 */
function analysisPayload(stored: StoredAnalysis, generated: boolean, admin: boolean) {
  return {
    attempted: true,
    analysis: stored.analysis,
    declineReason: stored.declineReason,
    sources: stored.sources,
    sourceGrade: stored.sourceGrade,
    analyzedAt: stored.analyzedAt,
    stale: isAnalysisStale(stored.promptVersion),
    generated,
    // Which model, which retrieval mode, how much text it read. Admins only.
    //
    // These columns exist so the two retrieval modes can be compared after the
    // fact rather than argued about, and that comparison is unreachable from
    // the UI without shipping them: someone re-running a title to try another
    // model otherwise has no way to see what the text already on screen was
    // written by, which makes a before/after meaningless. Withheld from
    // everyone else because it describes our infrastructure, not the film.
    provenance: admin
      ? {
          model: stored.model,
          retrievalMode: stored.retrievalMode,
          sourceCount: stored.sourceCount,
          retrievedChars: stored.retrievedChars,
          promptVersion: stored.promptVersion,
        }
      : undefined,
  }
}

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

      const admin = request.user?.isAdmin === true

      try {
        const stored = await getStoredAnalysis(mediaType, request.params.id)
        if (!stored) {
          return reply.send({ attempted: false, analysis: null })
        }
        return reply.send({
          ...analysisPayload(stored, false, admin),
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
   *
   * `?force=true` re-runs a title that already has a row, and is ADMIN-ONLY. It
   * exists because the two retrieval modes can only be judged by running both
   * over the same titles, which the cache otherwise makes impossible — but it
   * is also the one way to spend unboundedly by holding down a button, so the
   * cache stays authoritative for everyone else.
   */
  fastify.post<{ Params: { mediaType: string; id: string }; Querystring: { force?: string } }>(
    '/api/analysis/:mediaType/:id',
    { preHandler: requireAuth, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const mediaType = parseMediaType(request.params.mediaType)
      if (!mediaType) return reply.status(400).send({ error: 'Invalid media type' })

      const { id } = request.params
      const key = `${mediaType}:${id}`

      const admin = request.user?.isAdmin === true
      // Silently ignored for a non-admin rather than refused: the request is
      // still perfectly serviceable from cache, and failing it would turn a
      // stray query parameter into a broken page.
      const force = request.query.force === 'true' && admin

      // Did THIS request start the work? Only the originator logs the failure.
      // Single-flight means N concurrent POSTs share one analysis, and every
      // joiner's catch used to log the same line: a live failure appeared three
      // times, identically, which reads as three failures and pads a log that
      // is already mostly HTTP noise. Joiners still get the error in their
      // response, they just do not narrate it again.
      let owned = false

      try {
        const stored = force ? null : await getStoredAnalysis(mediaType, id)
        // A stored decline counts as an answer: re-asking spends a request to
        // receive the same "there is nothing to say" every time. Bumping
        // ANALYSIS_PROMPT_VERSION is what clears those deliberately — and a row
        // below the current version is exactly that case, so it falls through
        // to regeneration rather than being served back. This is the only route
        // an obsolete analysis has to a current one for a non-admin; without it
        // a prompt improvement reaches nothing already written, because the
        // batch job queues stale rows behind every title never analysed at all.
        const existing = stored && !isAnalysisStale(stored.promptVersion) ? stored : null
        if (existing) {
          return reply.send(analysisPayload(existing, false, admin))
        }

        const running = inFlight.get(key)
        if (running) {
          const joined = await running
          return reply.send(analysisPayload(joined, false, admin))
        }

        const subject = await loadAnalysisSubject(mediaType, id)
        if (!subject) return reply.status(404).send({ error: 'Title not found' })

        owned = true
        const work = analyseTitle(mediaType, id, subject).finally(() => inFlight.delete(key))
        inFlight.set(key, work)

        const result = await work
        return reply.send(analysisPayload(result, true, admin))
      } catch (err) {
        // A failure writes no row, so the title stays pending and both this
        // button and the batch job will try again. Surfaced as 503 rather than
        // 500: the usual causes are the retrieval service being unreachable or
        // its upstream search engines throttling, both temporary and neither
        // the caller's fault.
        // Summarised, not raw: pino copies an APICallError's enumerable own
        // properties in declaration order, and `requestBodyValues` -- the whole
        // ~16 KB prompt -- is declared before `statusCode`. Logging the error
        // itself buried the only field that says what went wrong.
        const described = describeAiError(err)
        if (owned) {
          logger.warn({ ...described, mediaType, id }, 'Title analysis generation failed')
        }

        const message = err instanceof Error ? err.message : 'Analysis failed'
        const unconfigured = /is not configured/i.test(message)
        if (unconfigured) {
          return reply.status(400).send({
            error: 'Title Analysis is not configured. Set it up in Settings > AI.',
          })
        }

        // This message used to blame the daily search quota unconditionally --
        // wrong twice over. It named the wrong half of the job for a model
        // failure, and it was a leftover from grounding mode: the default
        // retrieval mode is self-hosted and HAS no daily search quota, so the
        // one suggestion it made could never be the cause. Measured live, an
        // operator was told to wait until morning for a model endpoint that had
        // been withdrawn by its provider and would never come back on its own.
        //
        // The two halves fail for unrelated reasons and have unrelated fixes,
        // so the message says which one, and the status code when there is one
        // -- 401/403 is a key, 429 is a rate limit, 404 means the provider no
        // longer serves that model, 5xx is theirs to fix.
        if (described.isProviderError) {
          const status = described.status ? ` (HTTP ${described.status})` : ''
          return reply.status(503).send({
            error: `The Title Analysis model could not be reached${status}. Check the model and provider in Settings > AI; a free model may have been withdrawn by its provider.`,
          })
        }

        return reply.status(503).send({
          error:
            'Could not retrieve sources for this title. Check the retrieval service in Settings > Integrations; its search engines may be throttled right now.',
        })
      }
    }
  )
}

export default analysisRoutes
