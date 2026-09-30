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
  buildAnalysisSegments,
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
    // The same prose, cut into the runs the panel renders, each carrying the
    // questions the model said that run answers so the panel can head it. The
    // split is made here because the browser cannot make it: the panel's own
    // paragraph splitting does not agree with the map's numbering on rows the
    // model wrote without blank lines, so an index resolved there would label
    // the wrong prose. See core's analysis/segments.ts.
    //
    // `analysis` stays alongside it, unchanged, so a client written before
    // this still renders.
    paragraphs: stored.analysis
      ? buildAnalysisSegments(stored.analysis, stored.paragraphMap)
      : [],
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

/**
 * The last failure per key, so a POLLING client can collect one.
 *
 * A FAILED GENERATION WRITES NO ROW. That is correct — the title stays pending
 * and both this button and the batch job retry it — but it means a poll sees
 * `attempted: false, generating: false`, which is byte-identical to "nobody has
 * ever asked". Without this the panel would swallow every failure and quietly
 * offer the button again, which is worse than the held-open request it
 * replaced: at least that one said something.
 *
 * TTL rather than read-once. Several clients can poll one generation (two tabs,
 * two users on the same title), so the first reader must not consume the answer
 * the others are waiting for. It expires because a failure is news for as long
 * as somebody is still looking at the spinner it replaced, and stale news shown
 * to a reader who arrives tomorrow and asked for nothing is just a broken page.
 *
 * In memory, like `inFlight`. A restart loses it and the title reads as never
 * asked, which is the safe direction: the button comes back.
 */
const lastFailure = new Map<string, { error: string; at: number }>()
const FAILURE_TTL_MS = 10 * 60 * 1000

function readFailure(key: string): string | undefined {
  const found = lastFailure.get(key)
  if (!found) return undefined
  if (Date.now() - found.at > FAILURE_TTL_MS) {
    lastFailure.delete(key)
    return undefined
  }
  return found.error
}

/**
 * The sentence a failed generation shows, and the status a synchronous one
 * answers with.
 *
 * Extracted because the POST no longer awaits the work: it answers 202 and the
 * failure arrives minutes later with no request attached, so the shaping has to
 * be reachable from the background path too. Two callers, one wording.
 */
function describeAnalysisFailure(err: unknown): { status: number; error: string } {
  const message = err instanceof Error ? err.message : 'Analysis failed'
  if (/is not configured/i.test(message)) {
    return {
      status: 400,
      error: 'Title Analysis is not configured. Set it up in Settings > AI.',
    }
  }

  // This message used to blame the daily search quota unconditionally -- wrong
  // twice over. It named the wrong half of the job for a model failure, and it
  // was a leftover from grounding mode: the default retrieval mode is
  // self-hosted and HAS no daily search quota, so the one suggestion it made
  // could never be the cause. Measured live, an operator was told to wait until
  // morning for a model endpoint that had been withdrawn by its provider and
  // would never come back on its own.
  //
  // The two halves fail for unrelated reasons and have unrelated fixes, so the
  // message says which one, and the status code when there is one -- 401/403 is
  // a key, 429 is a rate limit, 404 means the provider no longer serves that
  // model, 5xx is theirs to fix.
  const described = describeAiError(err)
  if (described.isProviderError) {
    const status = described.status ? ` (HTTP ${described.status})` : ''
    return {
      status: 503,
      error: `The Title Analysis model could not be reached${status}. Check the model and provider in Settings > AI; a free model may have been withdrawn by its provider.`,
    }
  }

  return {
    status: 503,
    error:
      'Could not retrieve sources for this title. Check the retrieval service in Settings > Integrations; its search engines may be throttled right now.',
  }
}

/**
 * Start a generation nobody is waiting for, and record how it ends.
 *
 * NOTHING AWAITS THE RETURNED PROMISE ON A REQUEST PATH ANY MORE, so the
 * swallowing `catch` is load-bearing rather than defensive: an unhandled
 * rejection takes the process down, and this one rejects whenever a title
 * cannot be written, which is routine.
 *
 * THE ORDER OF THE THREE HANDLERS IS THE WHOLE RACE, and both halves of it
 * matter. `analyseTitle` commits its row before it resolves; the `catch`
 * records the failure before the `finally` clears `inFlight`. So by the time a
 * poll can observe `generating` go false, whichever of the two outcomes
 * happened is already readable — a poll can never stop on an answer that has
 * not landed yet. Reordering `catch` after `finally` reintroduces a window in
 * which the panel gives up and reports nothing.
 */
function startGeneration(
  mediaType: 'movie' | 'series',
  id: string,
  subject: NonNullable<Awaited<ReturnType<typeof loadAnalysisSubject>>>,
  key: string
): Promise<StoredAnalysis> {
  lastFailure.delete(key)

  const work = analyseTitle(mediaType, id, subject)
    .catch((err: unknown) => {
      // Summarised, not raw: pino copies an APICallError's enumerable own
      // properties in declaration order, and `requestBodyValues` -- the whole
      // ~16 KB prompt -- is declared before `statusCode`. Logging the error
      // itself buried the only field that says what went wrong.
      logger.warn({ ...describeAiError(err), mediaType, id }, 'Title analysis generation failed')
      lastFailure.set(key, { error: describeAnalysisFailure(err).error, at: Date.now() })
      throw err
    })
    .finally(() => inFlight.delete(key))

  work.catch(() => {})
  inFlight.set(key, work)
  return work
}

const analysisRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/analysis/:mediaType/:id
   *
   * Returns the cached analysis, or `{ analysis: null, attempted: false }` when
   * nothing has been generated yet. Never generates — the three states a client
   * must distinguish are "have one", "asked and declined", and "never asked",
   * and only the last offers a button.
   *
   * IT IS ALSO THE PROGRESS ENDPOINT. The POST answers 202 and the panel polls
   * here, so `generating` and `failure` ride on EVERY response including the
   * no-row one — a title being analysed for the first time has nothing stored,
   * and that early return used to drop both fields, which is exactly the case
   * the poll exists for.
   */
  fastify.get<{ Params: { mediaType: string; id: string } }>(
    '/api/analysis/:mediaType/:id',
    { preHandler: requireAuth, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const mediaType = parseMediaType(request.params.mediaType)
      if (!mediaType) return reply.status(400).send({ error: 'Invalid media type' })

      const admin = request.user?.isAdmin === true
      const key = `${mediaType}:${request.params.id}`

      try {
        // READ BEFORE THE ROW, and the order is the whole race. Work in flight
        // stores its row and only then clears this flag, so reading the flag
        // first means a response can be stale-optimistic (generating, row
        // already there — one wasted poll) but never stale-pessimistic
        // (generating false, row not yet visible), which would stop the poll
        // and leave the panel claiming nobody ever asked.
        const generating = inFlight.has(key)
        const failure = readFailure(key)

        const stored = await getStoredAnalysis(mediaType, request.params.id)
        if (!stored) {
          return reply.send({ attempted: false, analysis: null, generating, failure })
        }
        return reply.send({
          ...analysisPayload(stored, false, admin),
          generating,
          failure,
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
   * IT STARTS THE WORK AND ANSWERS 202; IT DOES NOT WAIT FOR IT. Writing an
   * analysis is minutes — retrieval, a ~21k-token prompt, up to
   * MAX_WRITE_ATTEMPTS per model with pacing in front of every request — and
   * this handler used to hold the connection open for all of it, sending no
   * byte until it was done. Whichever hop has the shortest patience for a first
   * byte therefore killed the request long before the work finished: measured
   * live as a spinner that stopped or a generic failure banner, while the
   * server carried on and stored a perfectly good row that appeared if you
   * waited and reloaded. Nothing server-side was ever wrong, and no server-side
   * timeout could have been tuned to fix it, because the connection was being
   * cut by something in front of it.
   *
   * So the wait moves to a poll of the GET, which already knew how to report
   * `generating`. Same shape as the discovery refresh, for the same reason
   * (F-104): a cold run is minutes and it used to hold the request open.
   *
   * 202 rather than 200 so a client can tell "here is your analysis" from
   * "come back for it" by status alone, without inspecting the body.
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

        // Single-flight still holds, and a joiner is told to poll like anyone
        // else. It used to await the shared promise, which put every joiner on
        // the same doomed long connection as the originator.
        if (inFlight.has(key)) {
          return reply.status(202).send({ generating: true })
        }

        const subject = await loadAnalysisSubject(mediaType, id)
        if (!subject) return reply.status(404).send({ error: 'Title not found' })

        startGeneration(mediaType, id, subject, key)

        // THE REQUESTER IS FREE TO LEAVE, which is the point. The old handler
        // logged a disconnect here and carried on regardless, because
        // cancelling would throw away minutes of paid inference over a closed
        // tab and the row is shared by every user once written. That reasoning
        // still stands; it simply has nothing left to guard, since nothing is
        // now waiting on the socket.
        return reply.status(202).send({ generating: true })
      } catch (err) {
        // Only the SYNCHRONOUS part of the request can fail here now — reading
        // the cache, loading the subject. Everything the generation itself can
        // throw arrives minutes later with no request attached and is recorded
        // in `lastFailure` for the poll to collect.
        logger.warn({ ...describeAiError(err), mediaType, id }, 'Title analysis request failed')

        const { status, error } = describeAnalysisFailure(err)
        return reply.status(status).send({ error })
      }
    }
  )
}

export default analysisRoutes
