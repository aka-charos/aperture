/**
 * Retrieve sources for one title and write its analysis.
 *
 * TWO STEPS, TWO SERVICES. fastCRW searches and scrapes (`lib/crw.ts`), then
 * the `titleAnalysis` model summarises what came back. That split replaced a
 * single grounded Gemini call, for two reasons:
 *
 * 1. COST. Grounded search is capped per day per Google project, and on a free
 *    tier the binding limit was the MODEL's request cap rather than the
 *    grounding one — measured at 20/day against a 1,500/day grounding
 *    allowance. Walking a 13,000-title library was therefore ~2 years per key.
 *    Both halves are now the operator's own hardware.
 *
 * 2. HONESTY, which matters more. Grounding gave the model search snippets and
 *    trusted it to reason; here the article text is in the prompt, so "use only
 *    the sources" is checkable rather than hopeful, and a small local model is
 *    doing organisation rather than recall — the task it is actually good at.
 *
 * THE ERROR CONTRACT IS THE SUBTLE PART. `analyseTitle` THROWS on any failure
 * that might be systemic and only stores a decline for an answer it believes.
 * A decline is permanent (the title is retired until ANALYSIS_PROMPT_VERSION
 * moves), so anything that could be "retrieval is broken right now" must retry
 * instead — see `retrieveSources`. This is the `enrichment_version` lesson and
 * the OMDb-401 lesson applied together: a transport failure that stamps a row
 * retires a library.
 */
import { generateText, streamText } from 'ai'

import {
  getFunctionConfig,
  getGroundingProviderTools,
  getTitleAnalysisModelAttempts,
  resolveCallSpacingMs,
  withGroundingModel,
  type ModelAttempt,
  getReasoningEffortFor,
  getReasoningProviderOptionsFor,
  getGenerationParamsForRole,
  getGenerationParamsFor,
} from '../lib/ai-provider.js'
import {
  crwSearch,
  getCrwConfig,
  isCrwEnabled,
  urlDomain,
  type CrwSearchEngine,
  type CrwSearchResponse,
} from '../lib/crw.js'
import { orderByHealth, recordEngineOutcome } from '../lib/crwEngines.js'
import { query, queryOne } from '../lib/db.js'
import { describeAiError } from '../lib/aiErrors.js'
import { streamLmStudioChat } from '../lib/lmstudioChat.js'
import { waitForCallSlot } from '../lib/callPacing.js'
import { createChildLogger } from '../lib/logger.js'
import { startStreamStallGuard, type StreamAbortReason } from '../lib/streamStall.js'
import { recordWebSearchCall } from '../lib/webSearchUsage.js'
import { budgetSources } from './budget.js'
import { isBlockedPage } from './blockedPage.js'
import { buildCuratedQuery, curatedSlots, mergeSearchResults } from './curatedSearch.js'
import { dropLowValueSources } from './sourceQuality.js'
import { findStructureProblem } from './structure.js'
import { dropDuplicateTitles } from './duplicateSources.js'
import { checkModeReadiness, type RetrievalMode } from './mode.js'
import { getAnalysisPromptVariant } from './promptSetting.js'
import {
  parseParagraphMap,
  splitAnalysisParagraphs,
  type ParagraphMap,
} from './paragraphMap.js'
import {
  ANALYSIS_PROMPT_VERSION,
  buildAnalysisPrompt,
  buildAnalysisQuery,
  parseAnalysisResponse,
  type AnalysisSource,
  type AnalysisSubject,
  type SourceGrade,
} from './prompt.js'
import {
  describeResponseProblem,
  describeResponseShape,
  findResponseProblem,
  stripReasoningBlocks,
  type ResponseProblem,
} from './response.js'
import {
  decideAnalysisFloor,
  type RetrievalEvidence,
  type RetrievedSource,
} from './sourceFloor.js'

const logger = createChildLogger('title-analysis')

/** Retries for a transport blip talking to the model. */
const MODEL_MAX_RETRIES = 2

/**
 * Attempts at getting a usable answer out of the model.
 *
 * This used to retry only an EMPTY response. Retrying an unusable one matters
 * far more: a model that buries its answer in a preamble, or drifts off the
 * output format, very often gets it right on a second pass — and the
 * alternative is failing a title over a one-off formatting slip.
 */
const MAX_WRITE_ATTEMPTS = 3
const RETRY_DELAY_MS = 500
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * A source as stored and shown, with the page text dropped.
 *
 * `url` is optional because only one retrieval mode has a durable one - see
 * `AnalysisSource.url`. Rows written before it was carried have none either,
 * so the panel has to treat a missing link as ordinary rather than broken.
 */
export interface AnalysisSourceRef {
  title: string
  domain: string
  url?: string
}

export interface StoredAnalysis {
  mediaType: 'movie' | 'series'
  mediaId: string
  analysis: string | null
  declineReason: string | null
  sources: AnalysisSourceRef[]
  sourceGrade: string | null
  sourceCount: number | null
  retrievedChars: number | null
  model: string | null
  /** Which approach produced this row — the whole point of storing it. */
  retrievalMode: RetrievalMode | null
  /**
   * Which paragraph of `analysis` answers which question, per the model.
   *
   * Null is ordinary rather than a fault: a row written under prompt version 5
   * or earlier has none, and so does one whose map failed validation. Anything
   * reading it must treat absence as "the analysis is undivided", never as an
   * error — see ./paragraphMap.ts.
   */
  paragraphMap: ParagraphMap | null
  promptVersion: number
  /** The variant that wrote it, or null for the version's own prompt (0180). */
  promptVariant: string | null
  analyzedAt: string
}

/** The stored analysis for a title, or null when it has never been attempted. */
export async function getStoredAnalysis(
  mediaType: 'movie' | 'series',
  mediaId: string
): Promise<StoredAnalysis | null> {
  const row = await queryOne<{
    analysis: string | null
    decline_reason: string | null
    sources: AnalysisSourceRef[] | null
    source_grade: string | null
    source_count: number | null
    retrieved_chars: number | null
    model: string | null
    retrieval_mode: RetrievalMode | null
    paragraph_map: ParagraphMap | null
    prompt_version: number
    prompt_variant: string | null
    analyzed_at: Date
  }>(
    `SELECT analysis, decline_reason, sources, source_grade, source_count,
            retrieved_chars, model, retrieval_mode, paragraph_map,
            prompt_version, prompt_variant, analyzed_at
       FROM title_analysis
      WHERE media_type = $1 AND media_id = $2`,
    [mediaType, mediaId]
  )
  if (!row) return null

  return {
    mediaType,
    mediaId,
    analysis: row.analysis,
    declineReason: row.decline_reason,
    sources: row.sources ?? [],
    sourceGrade: row.source_grade,
    sourceCount: row.source_count,
    retrievedChars: row.retrieved_chars,
    model: row.model,
    retrievalMode: row.retrieval_mode,
    paragraphMap: row.paragraph_map,
    promptVersion: row.prompt_version,
    promptVariant: row.prompt_variant,
    analyzedAt: row.analyzed_at.toISOString(),
  }
}

export interface Retrieval {
  /** Clipped to the configured budget, ready for the prompt. */
  sources: AnalysisSource[]
  /** What the floor judges: domain and size of each budgeted document. */
  evidence: RetrievedSource[]
  retrievedChars: number
}

/**
 * Search and scrape for one title.
 *
 * THROWS RATHER THAN RETURNING EMPTY, deliberately, in both failure cases:
 *
 *  * zero results — a working metasearch finds *something* for almost any
 *    released title, so nothing at all is far more likely to mean SearXNG's
 *    upstream engines are throttling or serving CAPTCHAs than that the title is
 *    unknown to the web. That is the documented fragility of self-hosted search
 *    and it is transient.
 *  * results but not one character of text — the search worked and every scrape
 *    failed, which is a renderer or network fault, not a fact about the title.
 *
 * Either could otherwise write a permanent decline for every title in the
 * library during an outage, and a blocked afternoon would quietly retire
 * thousands of rows. Sources that are present but *thin* are a different thing
 * and do reach `decideAnalysisFloor`, because there we genuinely did retrieve
 * the web's answer and it was poor.
 */
export async function retrieveSources(subject: AnalysisSubject): Promise<Retrieval> {
  const config = await getCrwConfig()
  if (!isCrwEnabled(config)) {
    throw new Error(
      'The retrieval service is not configured. Set it up in Settings > Integrations > Retrieval.'
    )
  }

  const queryText = buildAnalysisQuery(subject)
  // Retrieval is the long half of a title and used to be entirely silent: a run
  // spent minutes here while the app log said nothing at all and CRW's own log
  // showed it fetching pages the whole time. Announcing the query BEFORE the
  // call is what lets the two logs be read against each other.
  logger.info(
    { title: subject.title, query: queryText, engines: config.searchEngines },
    'Retrieving sources'
  )
  const startedAt = Date.now()

  // Try each configured engine in turn and keep the first that answers.
  //
  // A blocked engine is NOT an error: CRW replies `200 {results: []}` with a
  // warning, the same shape as a genuine "nothing found". So the cascade reads
  // an empty result as "ask the next one" rather than as an answer — which is
  // only safe because a title with genuinely no coverage costs a couple of
  // extra searches and then throws exactly as before.
  let response: CrwSearchResponse | null = null
  let engineUsed: CrwSearchEngine | null = null
  const attempts: string[] = []

  // Health-ordered rather than as configured: an engine that has come back
  // empty five titles running is a wall, and paying it one request per title
  // for the rest of a 13,000-title library is hours spent on a service that has
  // already said no. It goes to the BACK, never off the list — see crwEngines.
  for (const engine of orderByHealth(config.searchEngines)) {
    const attempt = await crwSearch(queryText, {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      maxResults: config.maxResults,
      maxContentChars: config.maxContentChars,
      timeoutMs: config.timeoutMs,
      engine,
    })
    recordEngineOutcome(engine, attempt.results.length > 0)
    if (attempt.results.length > 0) {
      response = attempt
      engineUsed = engine
      break
    }
    // Kept per engine rather than merged, or a message naming three warnings
    // gives no clue which engine produced which.
    attempts.push(
      attempt.warnings.length ? `${engine}: ${attempt.warnings.join("; ")}` : `${engine}: no results`
    )
    logger.warn({ title: subject.title, engine, warnings: attempt.warnings }, 'Search engine returned nothing')
  }

  // Carried into both throws below because these are the lines an operator
  // actually reads in a job log, and they are exactly the failures the service
  // explains on a 200 rather than with an error status.
  const reported = attempts.length ? ` Tried — ${attempts.join(' | ')}.` : ''

  if (!response || !engineUsed) {
    throw new Error(`Retrieval returned no results for "${queryText}".${reported}`)
  }

  let results = response.results

  // A SECOND search, restricted to publications that print criticism, merged
  // into the first. See ./curatedSearch.ts for why it is an addition rather
  // than a replacement, and why the merge reserves slots instead of sharing a
  // cut.
  //
  // It runs on the engine that just ANSWERED rather than through the cascade:
  // that engine is demonstrably responding, so an empty curated result means
  // "nothing on those sites", which for most titles is the correct answer -
  // and it holds the cost to one extra request instead of three.
  //
  // IT ASKS FOR ITS RESERVED SLOTS ONLY, never a full `maxResults`. This call
  // scrapes what it finds, so pages asked for are pages fetched and paid for;
  // requesting more than the merge can keep would buy page fetches to throw
  // away. Zero slots means the operator's budget cannot hold a curated result,
  // and then the search is not made at all.
  //
  // ITS OUTCOME IS DELIBERATELY NOT RECORDED AGAINST ENGINE HEALTH. Empty is
  // the expected outcome here, and five empty curated searches running would
  // otherwise park a perfectly healthy engine at the back of the cascade for
  // half an hour - see crwEngines.
  const criticismSlots = curatedSlots(config.maxResults)
  // Which results the criticism search supplied, so the sources can SAY so
  // further down. Keyed by URL because the merge dedupes on one.
  let criticismUrls = new Set<string>()
  try {
    const curated = criticismSlots
      ? await crwSearch(buildCuratedQuery(queryText), {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          maxResults: criticismSlots,
          maxContentChars: config.maxContentChars,
          timeoutMs: config.timeoutMs,
          engine: engineUsed,
        })
      : { results: [] }
    if (curated.results.length > 0) {
      const merged = mergeSearchResults(curated.results, results, {
        limit: config.maxResults,
      })
      criticismUrls = new Set(curated.results.map((r) => r.url))
      logger.info(
        {
          title: subject.title,
          engine: engineUsed,
          criticism: curated.results.map((r) => r.domain),
          merged: merged.length,
        },
        'Merged criticism search into retrieval'
      )
      results = merged
    } else {
      // LOGGED, because an empty criticism search and a criticism search that
      // never ran are the same silence otherwise - which is exactly how an
      // operator ends up unable to tell a deployed feature from an undeployed
      // one. Info rather than warn: nothing published on those twenty sites is
      // the ordinary answer for most of a library, not a fault.
      logger.info(
        { title: subject.title, engine: engineUsed, slots: criticismSlots },
        criticismSlots
          ? 'Criticism search returned nothing for this title'
          : 'Criticism search skipped — the result budget reserves no slot for it'
      )
    }
  } catch (err) {
    // Never fails the title. The general search has already answered, and this
    // is the half that is allowed to find nothing - so a retrieval service that
    // is up enough to have answered once must not lose a title on the second
    // ask. Nothing is hidden by swallowing it: crwSearch has already written
    // the fault to `api_errors` under the 'crw' provider before throwing.
    logger.warn({ title: subject.title, err }, 'Criticism search failed')
  }

  const fetched: AnalysisSource[] = results.map((r) => ({
    title: r.title,
    domain: r.domain,
    text: r.markdown,
    url: r.url,
    // Only ever set to true: `curated: false` on every general result would
    // claim the criticism search ran and rejected them, which is not what an
    // absent flag means (see AnalysisSource.curated).
    ...(criticismUrls.has(r.url) ? { curated: true } : {}),
  }))

  const fetchedChars = fetched.reduce((sum, s) => sum + s.text.length, 0)
  if (fetchedChars === 0) {
    throw new Error(
      `Retrieval returned ${results.length} result(s) but no page text — check the scraper.${reported}`
    )
  }

  // Bot checks and access walls come back as ordinary results with a little
  // text, and the budget below keeps a short document whole - so without this
  // they reach the prompt as numbered documents and count as retrieval. See
  // ./blockedPage.ts. Dropping them first also hands their share of the budget
  // to the pages that did answer.
  const blocked = fetched.filter((source) => isBlockedPage(source.text))
  const readable = blocked.length
    ? fetched.filter((source) => !isBlockedPage(source.text))
    : fetched
  if (blocked.length > 0) {
    logger.warn(
      { title: subject.title, blocked: blocked.map((source) => source.domain) },
      'Dropped bot-check and access-wall pages from retrieval'
    )
  }
  // Every page walled is the scraper being refused, not a fact about the title,
  // so it throws like an empty scrape rather than reaching the floor and being
  // stored as a decline.
  if (readable.every((source) => source.text.trim().length === 0)) {
    throw new Error(
      `Retrieval returned ${results.length} result(s) but every page was a bot check or access wall (${blocked
        .map((source) => source.domain)
        .join(', ')}) — the scraper is being blocked.${reported}`
    )
  }

  // Pages that were fetched perfectly well and are worth nothing: a listing
  // site's tag tables, a generated "analysis" page, a content farm whose
  // retrieved text is its own navigation menu. Dropped after the walls and
  // before the budget, so their share goes to the pages that did answer. Fails
  // open when they are all there is. See ./sourceQuality.ts.
  const { kept: worthwhile, dropped: lowValue } = dropLowValueSources(readable)
  if (lowValue.length > 0) {
    logger.warn(
      { title: subject.title, dropped: lowValue },
      'Dropped low-value pages from retrieval'
    )
  }

  // One chapter fetched from two sites is one document. See ./duplicateSources.ts.
  const { kept: distinct, dropped: duplicates } = dropDuplicateTitles(worthwhile, [
    subject.title,
    subject.originalTitle ?? '',
    subject.year ? String(subject.year) : '',
  ])
  if (duplicates.length > 0) {
    logger.warn(
      { title: subject.title, duplicates: duplicates.map((source) => source.domain) },
      "Dropped pages repeating another page's title"
    )
  }

  const sources = budgetSources(distinct, { budget: config.sourceBudgetChars })
  const retrievedChars = sources.reduce((sum, s) => sum + s.text.length, 0)

  // INFO, not debug. This is the line that says whether retrieval is healthy —
  // how many pages came back, how much text they carried, and which sites they
  // came from, which is what separates "six film-journal essays" from "six
  // where-to-watch listicles". At debug it was below the default level, so the
  // one useful record of the expensive half of the job was invisible in the
  // container log. One line per title, and a title takes minutes.
  logger.info(
    {
      title: subject.title,
      engine: engineUsed,
      results: results.length,
      fetchedChars,
      budgeted: sources.length,
      retrievedChars,
      domains: sources.map((s) => s.domain),
      // Survives the budget, which is the number that matters: a criticism
      // page found and then dropped for space is not a criticism page read.
      fromCriticism: sources.filter((s) => s.curated === true).length,
      ms: Date.now() - startedAt,
    },
    'Retrieved sources for analysis'
  )

  return {
    sources,
    evidence: sources.map((s) => ({ domain: s.domain, chars: s.text.length })),
    retrievedChars,
  }
}

/**
 * Token counts from one model call, all optional.
 *
 * Optional because a provider may report none, and an absent count must stay
 * absent rather than becoming a confident zero -- "the model used 0 output
 * tokens" and "this provider does not say" are different claims, and the first
 * one would make a truncation look impossible.
 *
 * `reasoningTokens` is the one worth having. It is billed from the same
 * allowance as the prose, so a reasoning model can exhaust the whole ceiling
 * thinking and return a fragment or nothing; without it a truncation looks like
 * a model that cannot follow instructions rather than a budget set too low.
 */
export interface AnalysisUsage {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}

/** Keep only the counts the provider actually reported. */
function readUsage(usage: unknown): AnalysisUsage {
  if (typeof usage !== 'object' || usage === null) return {}
  const source = usage as Record<string, unknown>
  const out: AnalysisUsage = {}
  for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens'] as const) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

export interface WriteResult {
  /** The prose, already unwrapped from the contract. */
  text: string
  /** The raw paragraph map, still unvalidated. Null when the model wrote none. */
  mapText: string | null
  /** The closing grade, or null when the model omitted it. */
  grade: SourceGrade | null
  /** Why the response is unusable, or null when it reads as an answer. */
  problem: ResponseProblem | null
  /** What the call cost, for the log line and the truncation message. */
  usage?: AnalysisUsage
  /** The ceiling this call ran under, so a truncation can name it. */
  maxOutputTokens?: number
  modelId: string
  finishReason?: string
  /** Only in grounding mode: what Google attached to the answer. */
  groundingChunks?: number
  groundingSources?: AnalysisSourceRef[]
}

/**
 * Read one raw completion against the output contract.
 *
 * Reasoning tags come off first because they are unambiguous; everything else
 * is decided by the markers the prompt asked for, never by inspecting the prose
 * and guessing.
 */
function readAnalysis(
  raw: string,
  finishReason: string | undefined,
  structure: { mediaType: 'movie' | 'series'; promptVersion?: number }
) {
  const parsed = parseAnalysisResponse(stripReasoningBlocks(raw))
  const paragraphs = parsed.text ? splitAnalysisParagraphs(parsed.text).length : 0
  return {
    text: parsed.text,
    grade: parsed.grade,
    // Still carried up raw, because ./segments.ts and the stored row want the
    // map the model actually wrote. It is now also JUDGED here rather than only
    // in analyseTitle: an unusable map means an unheaded article, and this is
    // the only frame that can still ask the model to try again. See ./structure.ts.
    mapText: parsed.mapText,
    problem:
      findResponseProblem({
        text: parsed.text,
        grade: parsed.grade,
        hadBeginMarker: parsed.hadBeginMarker,
        finishReason,
      }) ??
      findStructureProblem({
        paragraphs,
        map: parseParagraphMap(parsed.mapText, {
          paragraphCount: paragraphs,
          mediaType: structure.mediaType,
          ...(structure.promptVersion != null && { promptVersion: structure.promptVersion }),
        }),
      }),
  }
}

/**
 * How one model got on with one prompt.
 *
 * Three outcomes rather than a result-or-throw, because the caller's next move
 * differs for each: an answer ends the search, a provider failure moves to the
 * next model, and an unusable answer moves on too — except when it names a
 * SETTING, which no other model would escape either.
 */
export type AttemptOutcome =
  | { kind: 'ok'; result: WriteResult }
  | { kind: 'unusable'; result: WriteResult }
  | { kind: 'error'; error: unknown }
  | { kind: 'cancelled' }

export interface WriteOptions {
  /**
   * Which question labels the prompt offered, so the paragraph map can be
   * judged against the right vocabulary - only a series is asked about
   * `structure`. REQUIRED rather than optional, although every other field here
   * is optional: a caller that omitted it would silently skip the structure
   * half of the output contract and its answers would look identical to ones
   * that passed it, which is the defect an optional argument that changes the
   * answer always is.
   */
  mediaType: 'movie' | 'series'
  /** The version whose vocabulary applies. Absent means the current one; only the bench passes another. */
  promptVersion?: number
  shouldCancel?: () => Promise<boolean> | boolean
  /** Told when a pacing cool-off begins, so a job console can say why it is idle. */
  onWait?: (seconds: number) => void
  /**
   * The title being written, for the log lines on this path and nothing else.
   *
   * It was missing, and the cost was real: `Writing analysis` named the model,
   * the prompt size and the ceiling but not the FILM, so with a batch job
   * running beside an on-demand request there was no way to tell which line
   * belonged to which title except by guessing from timestamps.
   */
  title?: string
}

/**
 * How long a model may work before the log says it is still alive.
 *
 * The whole reason this exists: between `Writing analysis` and `Analysis
 * written` there was NOTHING, and a local or free-tier model with a large
 * output ceiling can sit in that gap for ten minutes or more. Silence there is
 * ambiguous in the worst way -- a healthy slow call, a provider that accepted
 * the connection and will never answer, and a container that was restarted
 * mid-write all look identical, which is to say they all look like nothing.
 *
 * Thirty seconds because the point is to distinguish working from wedged, and a
 * minute of nothing is already long enough to start guessing. A healthy fast
 * call finishes inside the first interval and logs none of these, so the cost
 * is paid only by the calls that are actually worth watching.
 */
const WRITE_HEARTBEAT_MS = 30_000

/**
 * Silence from the model's stream that means the call is hung, not slow.
 *
 * Ten minutes, and the number is chosen against what a healthy call looks like
 * rather than against what feels patient: measured over one batch, a title took
 * 46 to 102 seconds end to end, retrieval included. Ten minutes of a stream
 * delivering NOTHING is therefore two orders of magnitude outside normal, which
 * is the property that matters — the guard must never be the thing that ends a
 * slow answer, and a reasoning model's scratchpad counts as activity only when
 * the provider streams it, so the window has to survive a long think that
 * surfaces nothing at all.
 *
 * See ../lib/streamStall.ts for why this is a stall window rather than a cap on
 * the call.
 */
const WRITE_STALL_MS = 10 * 60 * 1000

/**
 * The backstop, for a stream that stays technically alive forever.
 *
 * One hour, matching `LOCAL_INFERENCE_TIMEOUT_MS`: far above any real
 * generation, including a large local model working through a 64,000-character
 * prompt. Nothing observed has come close to it; the stall window is the
 * instrument that catches a hang, and this only catches the shape the stall
 * window cannot see.
 */
const WRITE_DEADLINE_MS = 60 * 60 * 1000

/**
 * Say, periodically, that a model call is still running.
 *
 * `unref()` is load-bearing: a pending interval otherwise keeps the Node event
 * loop alive, so a timer left running by a throw on some path nobody thought
 * about would stop the process exiting. Cleared in a `finally` regardless.
 */
function startWriteHeartbeat(
  context: Record<string, unknown>
): { stop: () => void; note: (phase: string) => void } {
  const startedAt = Date.now()
  // The last phase the model reported, when it reports any. LM Studio's native
  // endpoint does; nothing else can, so this stays absent rather than guessing.
  // Stored rather than logged per event: a delta arrives per token, and the
  // heartbeat is the thing with a sane interval.
  let phase: string | undefined
  const timer = setInterval(() => {
    logger.info(
      {
        ...context,
        ...(phase != null && { phase }),
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      },
      'Still waiting for the analysis model'
    )
  }, WRITE_HEARTBEAT_MS)
  timer.unref()
  return {
    stop: () => clearInterval(timer),
    note: (next: string) => {
      phase = next
    },
  }
}

/**
 * What an abandoned call means to the caller.
 *
 * A cancellation is not a failure: it ends the run rather than counting against
 * the title, and `analyseTitle` turns it into `AnalysisCancelledError` so the
 * job stops cleanly with the title still pending.
 *
 * A stall or a passed deadline IS a failure, and deliberately the rotating kind
 * — the model stopped answering, which is a fact about that model, so the next
 * fallback gets a turn. It carries a written-out message because the whole
 * complaint it answers was a run that said nothing about why it was stuck:
 * whatever reads this next (a log, the fallback line, the job console once the
 * consecutive-failure guard fires) should be able to state the cause without
 * anyone going to the provider's dashboard.
 */
function abortOutcome(
  reason: StreamAbortReason,
  modelId: string,
  startedAt: number
): AttemptOutcome {
  if (reason === 'cancelled') return { kind: 'cancelled' }
  const seconds = Math.round((Date.now() - startedAt) / 1000)
  const cause =
    reason === 'stalled'
      ? `produced no output for ${Math.round(WRITE_STALL_MS / 60_000)} minutes`
      : `ran past the ${Math.round(WRITE_DEADLINE_MS / 60_000)}-minute ceiling for one call`
  return {
    kind: 'error',
    error: new Error(`${modelId} ${cause} (${seconds}s in); the request was abandoned`),
  }
}

/**
 * Run one model until it answers, gives up, or proves it cannot follow the format.
 *
 * Exported for the comparison bench (./compare.ts), which needs exactly this —
 * one model, one prompt, one outcome — without the rotation, the storage or the
 * decline that `analyseTitle` wraps around it. Keeping the bench on this
 * function rather than on a copy is what makes a comparison a fact about the
 * models: it runs the retries, the pacing and the contract checks the real
 * generation path runs, so a model that reads well here reads well in the job.
 */
export async function runWriteAttempt(
  attempt: ModelAttempt,
  prompt: string,
  maxOutputTokens: number,
  options: WriteOptions
): Promise<AttemptOutcome> {
  const { model, modelId } = attempt

  // Resolved against THIS attempt's provider AND model, not the role's. A
  // fallback may live on a different provider, and two models on one provider
  // need not share a vocabulary — OpenRouter publishes 21 of them. Getting
  // either wrong is not an error: providerOptions in a namespace the active
  // provider does not own are silently ignored, so the scratchpad quietly stays
  // uncapped on exactly the fallback path that already means something is wrong.
  const reasoning = await getReasoningProviderOptionsFor(
    attempt.provider,
    modelId,
    'titleAnalysis',
    await getReasoningEffortFor('titleAnalysis')
  )

  // Resolved per attempt for the same reason, and it is not the same reason as
  // reasoning's: sampling values carry no provider namespace, so a fallback on
  // another provider would accept them silently rather than ignore them. What
  // is per-attempt here is whether the MODEL declares them at all — measured,
  // 87 of 439 OpenRouter models refuse `temperature` — and a local fallback
  // declares nothing, so the resolver returns an empty object and the request
  // is byte-identical to what it was before this existed.
  const sampling = await getGenerationParamsFor(
    attempt.provider,
    modelId,
    'titleAnalysis',
    await getGenerationParamsForRole('titleAnalysis')
  )

  // The other silent half. A local model chewing through ~18k tokens of article
  // text is minutes of wall clock with nothing to show for it, and on a
  // self-hosted setup this is the step most likely to be the slow one - so the
  // model id, the prompt size and the output ceiling are logged before the
  // call, not just after. Together with the retrieval line above, every long
  // pause in a run now has a log line saying which of the two services owns it.
  logger.info(
    {
      title: options.title,
      modelId,
      provider: attempt.provider,
      fallback: attempt.isFallback || undefined,
      promptChars: prompt.length,
      maxOutputTokens: maxOutputTokens || 'unlimited',
    },
    'Writing analysis'
  )
  const startedAt = Date.now()

  let reading = {
    text: '',
    mapText: null as string | null,
    grade: null as SourceGrade | null,
    problem: null as ResponseProblem | null,
  }
  let finishReason: string | undefined
  let usage: AnalysisUsage = {}
  let generationId: string | undefined
  let attemptsMade = 0

  for (let i = 1; i <= MAX_WRITE_ATTEMPTS; i++) {
    attemptsMade = i
    // Immediately before EVERY request, including the retries below: a retry is
    // a request the provider counts, so pacing that covered only the first one
    // would let a title needing three attempts spend three of a per-minute
    // allowance in as many seconds. Keyed on the provider, because the limit
    // belongs to the account rather than to this role.
    const paced = await waitForCallSlot('provider:' + attempt.provider, attempt.spacingMs, options)
    if (paced.cancelled) return { kind: 'cancelled' }

    let response
    // The one genuinely unobservable stretch in this file, and the reason the
    // heartbeat exists. Everything either side of it logs; this await could sit
    // for ten minutes saying nothing.
    const heartbeat = startWriteHeartbeat({
      title: options.title,
      modelId,
      provider: attempt.provider,
      attempt: i,
    })
    // The ceiling. Streaming means neither of Node's own timeouts can end this
    // call (see ../lib/streamStall.ts), so without a signal a stream that goes
    // silent holds the whole run — measured at 8h45m on one title, unstoppable,
    // because cancellation is polled between titles and this one never got
    // there. The guard also carries `shouldCancel`, which is what gives Stop
    // reach into a request already in flight.
    const guard = startStreamStallGuard({
      stallMs: WRITE_STALL_MS,
      deadlineMs: WRITE_DEADLINE_MS,
      shouldCancel: options.shouldCancel,
      onAbort: (reason, elapsedMs) =>
        logger.warn(
          {
            title: options.title,
            modelId,
            provider: attempt.provider,
            attempt: i,
            reason,
            elapsedSeconds: Math.round(elapsedMs / 1000),
          },
          reason === 'cancelled'
            ? 'Cancelled mid-call; abandoning the analysis request'
            : 'Analysis model call abandoned: it stopped producing output'
        ),
    })
    // STREAMED, and not for progress — for survival. Node's fetch enforces its
    // own 300s `headersTimeout` that no AbortSignal can extend (measured on
    // v24.18.0: a withheld response fails at 306.5s with UND_ERR_HEADERS_TIMEOUT
    // with no signal involved). A non-streaming call gets no response headers
    // until the model has finished, so a local model slower than five minutes
    // could never complete this call whatever the ceilings were set to.
    // Measured: a 26B model at ~12 tokens/sec was cut off mid-sentence at
    // exactly 300s against a 32,000-token budget needing about 45 minutes.
    //
    // An SSE response sends headers at once and chunks continuously, so neither
    // of Node's timeouts is ever approached. Nothing here consumes the stream
    // incrementally; the promises below are awaited exactly as the
    // non-streaming result was read.
    //
    // `onError` is load-bearing, not logging. `streamText` does not throw the
    // provider's error — awaiting its promises rejects with a generic
    // `AI_NoOutputGeneratedError` whose message is "No output generated",
    // carrying no status and none of the provider's own words. That is the one
    // thing `describeAiError` exists to preserve, so the real error is captured
    // here and rethrown in its place.
    let streamError: unknown
    try {
      // LM STUDIO GOES THROUGH ITS OWN ENDPOINT, and only for this role.
      //
      // The assistant cannot: `/api/v1/chat` is marked ❌ for custom tools and
      // ❌ for assistant messages in the request, and the assistant is twelve
      // local tools over several steps. Title analysis is retrieval, then one
      // prompt, then one answer — it needs neither, so it is the only role that
      // can pay this endpoint's price, and the one that gains most from it.
      //
      // What it gains is diagnosis. On the OpenAI-compatible path a reasoning
      // model that never finished thinking returns an empty `content` and looks
      // exactly like one that said nothing; here reasoning and message are
      // separate event streams, a cold load reports progress instead of
      // sitting silent, and the close carries `reasoning_output_tokens`,
      // `tokens_per_second` and `time_to_first_token_seconds` — the three
      // numbers that say whether a slow title was the prompt, the thinking or
      // the hardware.
      if (attempt.provider === 'lmstudio') {
        const native = await streamLmStudioChat({
          model: modelId,
          input: prompt,
          baseUrl: attempt.baseUrl,
          apiKey: attempt.apiKey,
          // This client has always accepted a signal, and its docstring has
          // always said the caller's signal is the only way to stop it.
          // Nothing passed one.
          signal: guard.signal,
          progress: {
            // Every event counts as activity, including the two that arrive
            // before a single token does: a cold model load and a 64k-character
            // prompt read are exactly when a healthy call is silent longest.
            onModelLoad: (p) => {
              guard.activity()
              heartbeat.note(`loading model ${Math.round(p * 100)}%`)
            },
            onPromptProgress: (p) => {
              guard.activity()
              heartbeat.note(`reading prompt ${Math.round(p * 100)}%`)
            },
            // Deliberately counted rather than accumulated: the point is to say
            // WHICH of the two the model is doing, since that is the whole
            // difference between "still thinking" and "writing the answer".
            onReasoningDelta: () => {
              guard.activity()
              heartbeat.note('thinking')
            },
            onMessageDelta: () => {
              guard.activity()
              heartbeat.note('writing')
            },
          },
        })

        logger.info(
          {
            title: options.title,
            modelId,
            attempt: i,
            instance: native.modelInstanceId,
            responseId: native.responseId,
            textChars: native.text.length,
            reasoningChars: native.reasoningText.length,
            ...native.stats,
          },
          'LM Studio finished the analysis call'
        )

        // No sampling values reach this branch, and that is the resolver's
        // answer rather than a gap: `getGenerationParamsFor` returns an empty
        // object for LM Studio, because nothing has verified what its
        // OpenAI-compatible endpoint accepts and the native chat API is a
        // different surface again. See ../lib/generationParams.ts.
        response = {
          text: native.text,
          reasoningText: native.reasoningText,
          // This endpoint reports no finish reason of its own on every shape.
          // Absent must NOT read as 'length': that is the truncation verdict,
          // and asserting it without evidence would blame a ceiling for a model
          // that simply stopped.
          finishReason: native.finishReason ?? 'stop',
          usage: {
            inputTokens: native.stats?.inputTokens,
            outputTokens: native.stats?.totalOutputTokens,
            totalTokens:
              native.stats?.inputTokens != null && native.stats?.totalOutputTokens != null
                ? native.stats.inputTokens + native.stats.totalOutputTokens
                : undefined,
            reasoningTokens: native.stats?.reasoningOutputTokens,
          },
          response: { id: native.responseId },
        }
      } else {
      const stream = streamText({
        model,
        prompt,
        maxRetries: MODEL_MAX_RETRIES,
        // Forwarded to the provider's fetch, which is what actually ends a
        // request the model has stopped answering.
        abortSignal: guard.signal,
        // The activity feed. Reasoning deltas reach this callback too, so a
        // model that thinks for nine minutes and streams its scratchpad reads
        // as alive; one that streams nothing at all is what the stall window
        // is sized for.
        onChunk: () => guard.activity(),
        // Omitted entirely when unset, so a role that has never chosen an
        // effort sends the request it sent before this existed.
        ...(reasoning ? { providerOptions: reasoning } : {}),
        // Spread rather than assigned, because `temperature: undefined` is not
        // the same request as omitting the field on every provider.
        ...sampling,
        // 0 means the operator asked for no ceiling, so none is sent and the
        // provider default applies.
        ...(maxOutputTokens > 0 ? { maxOutputTokens } : {}),
        onError: ({ error }) => {
          streamError = error
        },
      })

      const reads = Promise.all([
        stream.text,
        stream.reasoningText,
        stream.finishReason,
        stream.usage,
        stream.response,
      ])
      // A second handler, so abandoning these on the abort branch below cannot
      // become an unhandled rejection and take the process down later.
      reads.catch(() => {})

      // RACED, NOT AWAITED, and this is the whole fix rather than a nicety.
      // Measured on ai@5.0.118: aborting the signal closes the socket, and
      // this promise bundle then NEVER settles — not resolved, not rejected,
      // with `onAbort` never called. So the signal alone repairs the
      // connection and leaves this frame hung exactly as it was before the
      // guard existed. (`for await (stream.fullStream)` throws instead, which
      // is why the Watcher Identity's loop needs no race.) See
      // ../lib/streamStall.ts.
      const settled = await Promise.race([
        reads.then((value) => ({ read: value, aborted: null }) as const),
        guard.aborted.then((reason) => ({ read: null, aborted: reason }) as const),
      ])
      if (settled.aborted) {
        return abortOutcome(settled.aborted, modelId, startedAt)
      }
      const [text, reasoningText, streamFinishReason, streamUsage, meta] = settled.read
      response = { text, reasoningText, finishReason: streamFinishReason, usage: streamUsage, response: meta }
      }
    } catch (err) {
      // An abort is this guard's doing rather than the provider's, so it must
      // not be reported as one: describeAiError would print an AbortError with
      // no status, which reads as a mysterious dropped connection instead of a
      // stream that went silent or a job somebody stopped.
      const aborted = guard.reason()
      if (aborted) {
        return abortOutcome(aborted, modelId, startedAt)
      }
      // Logged here because this is the only frame that knows which model and
      // which attempt. RETURNED rather than thrown so the caller can move to a
      // fallback model; with no fallback left it rethrows and the title stays
      // pending, which is what gets it retried on the next run.
      //
      // describeAiError rather than the raw error on purpose. `APICallError`
      // declares `requestBodyValues` before `statusCode`, and pino serializes
      // in declaration order -- so logging `{ err }` put ~16 KB of scraped
      // article text ahead of the one field that says what went wrong.
      logger.error(
        {
          ...describeAiError(streamError ?? err),
          title: options.title,
          modelId,
          attempt: i,
          promptChars: prompt.length,
          elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        },
        'Title analysis model call failed'
      )
      return { kind: 'error', error: streamError ?? err }
    } finally {
      heartbeat.stop()
      guard.stop()
    }
    finishReason = response.finishReason
    usage = readUsage(response.usage)
    // The provider's own id for this generation. On OpenRouter it is the
    // `gen-…` that addresses its dashboard directly, which is the difference
    // between comparing two records and hunting through both by timestamp --
    // and this path had no shared key with the provider at all. Kept for the
    // final line too, so a title that succeeded is equally traceable.
    generationId = response.response?.id
    reading = readAnalysis(response.text ?? '', response.finishReason, {
      mediaType: options.mediaType,
      ...(options.promptVersion != null && { promptVersion: options.promptVersion }),
    })

    if (!reading.problem) break

    // WHAT THE MODEL ACTUALLY SENT, logged only when it was rejected. A
    // healthy title has no use for it and would otherwise put a few hundred
    // characters of prose in the log per call; a rejected one is unreadable
    // without it, which is the whole complaint. `reasoningChars` is the field
    // that names the failure this was written for -- a model whose answer went
    // to the reasoning channel returns an empty content channel and looks
    // exactly like one that said nothing.
    const shape = describeResponseShape({
      text: response.text ?? '',
      reasoningText: response.reasoningText,
    })

    if (i < MAX_WRITE_ATTEMPTS) {
      logger.warn(
        {
          title: options.title,
          attempt: i,
          modelId,
          generationId,
          problem: reading.problem.kind,
          finishReason,
          ...shape,
          ...usage,
          maxOutputTokens,
        },
        'Analysis response was not usable; retrying'
      )
      await sleep(RETRY_DELAY_MS)
    } else {
      // The last attempt has no retry line, so without this the final rejection
      // would carry the verdict and none of the evidence for it.
      logger.warn(
        {
          title: options.title,
          attempt: i,
          modelId,
          generationId,
          problem: reading.problem.kind,
          finishReason,
          ...shape,
          ...usage,
          maxOutputTokens,
        },
        'Analysis response was not usable and no attempts remain'
      )
    }
  }

  // ONE SELF-CONTAINED LINE. This used to carry the outcome without the budget
  // it was measured against: `finishReason: 'length'` said a ceiling had been
  // hit but not which, so reading it meant finding the "Writing analysis" line
  // from before the call -- thirteen minutes and several hundred HTTP request
  // lines earlier in a live log. Whoever is diagnosing a failure should not
  // have to correlate two lines to learn one number.
  //
  // `reasoningTokens` is the field that actually explains a truncation: it is
  // billed from the SAME allowance as the prose, so a model can spend the whole
  // budget thinking and emit nothing. Measured on the explanations path at
  // 2,079 and 2,283 tokens against a 3,000 ceiling; this path had the identical
  // failure and logged none of it, which is why the cause had to be guessed at.
  logger.info(
    {
      title: options.title,
      modelId,
      provider: attempt.provider,
      generationId,
      fallback: attempt.isFallback || undefined,
      textChars: reading.text.length,
      hasMap: reading.mapText != null,
      grade: reading.grade,
      problem: reading.problem?.kind,
      finishReason,
      attempts: attemptsMade,
      promptChars: prompt.length,
      maxOutputTokens: maxOutputTokens || 'unlimited',
      ...usage,
      ms: Date.now() - startedAt,
    },
    'Analysis written'
  )

  const result: WriteResult = { ...reading, modelId, finishReason, usage, maxOutputTokens }
  return reading.problem ? { kind: 'unusable', result } : { kind: 'ok', result }
}

/**
 * Write the analysis, trying each configured model in turn.
 *
 * WHAT ROTATES AND WHAT DOES NOT. A provider failure rotates: 429, 5xx, the 404
 * a withdrawn endpoint answers with, a dropped connection — every one of them
 * means this model cannot answer right now and another one might. An answer
 * that breaks the output contract rotates too, once this model has had its
 * retries, because "cannot follow the format" is a fact about the model and a
 * different one may manage it — that failure has already cost a library pass.
 *
 * A TRUNCATION DOES NOT ROTATE, and the exception is the interesting one. It
 * names a SETTING: the output ceiling was reached, and every model would reach
 * it identically, so rotating would spend a second model to reproduce the same
 * result and then report the second model's name — sending the operator after
 * the wrong thing entirely. The message thrown instead says which number to
 * change and where it lives.
 */
async function writeFromSources(
  prompt: string,
  maxOutputTokens: number,
  options: WriteOptions
): Promise<WriteResult> {
  const attempts = await getTitleAnalysisModelAttempts()

  let lastError: unknown
  let lastUnusable: WriteResult | null = null

  for (const [index, attempt] of attempts.entries()) {
    const outcome = await runWriteAttempt(attempt, prompt, maxOutputTokens, options)

    if (outcome.kind === 'ok') {
      if (index > 0) {
        logger.info(
          { modelId: attempt.modelId, provider: attempt.provider, position: index },
          'Analysis written by a fallback model'
        )
      }
      return outcome.result
    }

    if (outcome.kind === 'cancelled') throw new AnalysisCancelledError()

    if (outcome.kind === 'unusable') {
      lastUnusable = outcome.result
      // The setting, not the model. Stop here so the thrown message names the
      // ceiling rather than whichever model happened to be last in the list.
      if (outcome.result.problem?.kind === 'truncated') return outcome.result
    } else {
      lastError = outcome.error
    }

    const next = attempts[index + 1]
    if (next) {
      logger.warn(
        {
          failed: attempt.modelId,
          reason: outcome.kind === 'error' ? 'provider' : outcome.result.problem?.kind,
          fallingBackTo: next.modelId,
          provider: next.provider,
        },
        'Title analysis falling back to the next model'
      )
    }
  }

  // Every model was tried. An unusable answer is preferred over a raw provider
  // error because it produces the operator-facing sentence in ./response.ts,
  // which names the fault in words; a rethrown provider error is the right
  // answer only when nothing ever answered at all.
  if (lastUnusable) return lastUnusable
  throw lastError ?? new Error('The Title Analysis model produced no response.')
}

/**
 * Turn Google's grounding sources into something worth storing.
 *
 * Drops the URL deliberately: Google returns `vertexaisearch…/
 * grounding-api-redirect/…` links that expire, so a cache meant to live for
 * months would fill with dead links. The redirect host is also identical for
 * every source, so showing it as provenance would tell a reader nothing — which
 * is why a domain that looks like one is blanked rather than displayed.
 */
function extractGroundingSources(raw: unknown): AnalysisSourceRef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: AnalysisSourceRef[] = []

  for (const entry of raw) {
    const source = entry as { title?: unknown; url?: unknown }
    const title = typeof source.title === 'string' ? source.title.trim() : ''
    let domain = typeof source.url === 'string' ? urlDomain(source.url) : ''
    if (domain.includes('vertexaisearch') || domain.includes('grounding-api')) domain = ''
    if (!title && !domain) continue

    const key = `${title}|${domain}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ title: title || domain, domain })
  }

  return out
}

/**
 * One natively-grounded call: the model searches for itself.
 *
 * Runs through `withGroundingModel`, which is what rotates keys on a 429, parks
 * an exhausted one and writes `web_search_usage` — so this mode is metered
 * exactly like the assistant's discovery, and `web_search_usage.role` is what
 * separates the two. The empty-text retry inside is metered by hand for the
 * usual reason: the wrapper records once per KEY attempt, and this loop sits
 * inside one of them, so without it a request Google counts is invisible.
 */
async function writeWithGrounding(
  prompt: string,
  maxOutputTokens: number,
  options: WriteOptions
): Promise<WriteResult> {
  const tools = await getGroundingProviderTools('titleAnalysis')
  // Read once, outside the key loop: pacing is a property of the role's
  // credentials, and re-reading it per attempt would just be another database
  // round trip inside a retry.
  //
  // NOTE the deliberate asymmetry with the CRW path above: grounding mode does
  // NOT rotate models. Its model choice is already constrained to Google's
  // grounding-capable ones, and its characteristic failure is a spent daily
  // quota — which `withGroundingModel` answers by rotating KEYS, since a second
  // model on the same exhausted project would fail identically.
  const spacingMs = resolveCallSpacingMs(await getFunctionConfig('titleAnalysis'))
  // Read once beside the spacing and for the same reason: a property of the
  // role, not of the attempt, so re-reading it inside the key loop would be a
  // database round trip per retry.
  const reasoningEffort = await getReasoningEffortFor('titleAnalysis')
  const samplingParams = await getGenerationParamsForRole('titleAnalysis')

  return withGroundingModel('titleAnalysis', async (model, keyAttempt) => {
    let result: WriteResult = {
      text: '',
      mapText: null,
      grade: null,
      problem: null,
      modelId: keyAttempt.modelId,
    }
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined

    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      // Same gate and same key as the CRW path, so the two modes cannot pace
      // differently. Cancellation lands inside the wait rather than after it.
      const paced = await waitForCallSlot('provider:' + keyAttempt.provider, spacingMs, options)
      if (paced.cancelled) throw new AnalysisCancelledError()

      const reasoning = await getReasoningProviderOptionsFor(
        keyAttempt.provider,
        keyAttempt.modelId,
        'titleAnalysis',
        reasoningEffort
      )

      // Grounding is Google-only and native Google declares no sampling
      // parameters, so in practice this resolves to nothing and the grounded
      // request is unchanged. It is wired anyway because the alternative is one
      // of the role's two paths quietly ignoring a setting the card shows — the
      // partial-coverage fault ROLES_WITH_GENERATION_PARAMS exists to avoid.
      const sampling = await getGenerationParamsFor(
        keyAttempt.provider,
        keyAttempt.modelId,
        'titleAnalysis',
        samplingParams
      )

      // Same silent stretch as the CRW path, and grounded calls are slower
      // still because the model searches before it writes.
      const heartbeat = startWriteHeartbeat({
        title: options.title,
        modelId: keyAttempt.modelId,
        provider: keyAttempt.provider,
        keySlot: keyAttempt.slot,
        attempt,
      })
      let response
      try {
        response = await generateText({
          model,
          tools,
          prompt,
          maxRetries: MODEL_MAX_RETRIES,
          ...(reasoning ? { providerOptions: reasoning } : {}),
          ...sampling,
          ...(maxOutputTokens > 0 ? { maxOutputTokens } : {}),
        })
      } finally {
        heartbeat.stop()
      }
      usage = response.usage

      const grounding = (
        response.providerMetadata?.google as
          | { groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: unknown[] } }
          | undefined
      )?.groundingMetadata

      const reading = readAnalysis(response.text ?? '', response.finishReason, {
        mediaType: options.mediaType,
        ...(options.promptVersion != null && { promptVersion: options.promptVersion }),
      })
      result = {
        ...reading,
        modelId: response.response?.modelId ?? keyAttempt.modelId,
        finishReason: response.finishReason,
        usage: readUsage(response.usage),
        maxOutputTokens,
        groundingChunks: grounding?.groundingChunks?.length ?? 0,
        groundingSources: extractGroundingSources(response.sources),
      }

      logger.info(
        {
          title: options.title,
          attempt,
          keySlot: keyAttempt.slot,
          modelId: result.modelId,
          generationId: response.response?.id,
          webSearchQueries: grounding?.webSearchQueries?.length ?? 0,
          groundingChunks: result.groundingChunks,
          textChars: result.text.length,
          hasMap: result.mapText != null,
          problem: result.problem?.kind,
          finishReason: response.finishReason,
          maxOutputTokens: maxOutputTokens || 'unlimited',
          ...result.usage,
        },
        'Title analysis grounding completed'
      )

      if (!result.problem) break

      // Same evidence as the CRW path, and needed here for the same reason: a
      // verdict with nothing behind it cannot be acted on.
      logger.warn(
        {
          title: options.title,
          attempt,
          modelId: result.modelId,
          generationId: response.response?.id,
          problem: result.problem.kind,
          finishReason: response.finishReason,
          ...describeResponseShape({
            text: response.text ?? '',
            reasoningText: response.reasoningText,
          }),
          ...result.usage,
        },
        attempt < MAX_WRITE_ATTEMPTS
          ? 'Grounded analysis unusable; retrying'
          : 'Grounded analysis unusable and no attempts remain'
      )

      if (attempt < MAX_WRITE_ATTEMPTS) {
        // Metered by hand: withGroundingModel records once per KEY attempt and
        // this loop sits inside one of them, so a request Google counts would
        // otherwise be invisible.
        await recordWebSearchCall({
          role: 'titleAnalysis',
          provider: keyAttempt.provider,
          model: keyAttempt.modelId,
          slot: keyAttempt.slot,
          status: 'empty',
          ...response.usage,
        })
        await sleep(RETRY_DELAY_MS)
      }
    }

    return { value: result, usage }
  })
}
/**
 * Analyse one title and store the outcome.
 *
 * Returns the stored row on success OR decline — both are results. Throws on
 * anything that might be transient, which is what keeps the title pending: no
 * row is written, so the next run picks it up again. Callers that batch must
 * let the throw through (and count the attempt) rather than converting it into
 * a stored decline, or one bad afternoon would retire titles permanently. That
 * is exactly the mistake that let a run of OMDb 401s stamp an entire library
 * complete.
 */
/**
 * Thrown when a caller's `shouldCancel` fires part-way through a title.
 *
 * Distinct from a failure so a batch can tell "stopped on request" from "this
 * title is broken" — both leave the row unwritten and pending, but only one of
 * them should end the run.
 */
export class AnalysisCancelledError extends Error {
  constructor() {
    super('Title analysis cancelled')
    this.name = 'AnalysisCancelledError'
  }
}

export interface AnalyseTitleOptions {
  /**
   * Polled at the one seam inside a title: after retrieval, before inference.
   *
   * Cancelling is cooperative and nothing interrupts an in-flight request, so
   * the granularity of Stop is however long the current step runs. A title is
   * two long steps — a search plus several page fetches (up to the 180s
   * retrieval timeout), then a few thousand tokens through the writing model —
   * and checking only between titles meant pressing Stop did nothing visible
   * for minutes, which reads as a button that does not work.
   */
  shouldCancel?: () => Promise<boolean> | boolean
  /**
   * Told when a pacing cool-off starts, and how long it will last.
   *
   * A free-tier cool-off is a deliberate pause of up to a minute in the middle
   * of a job whose other steps are already minutes long. Unannounced it is
   * indistinguishable from a wedged run — the same failure the "Retrieving
   * sources" and "Writing analysis" lines exist to prevent — so the batch job
   * routes this into its console rather than leaving it only in the container
   * log.
   */
  onWait?: (seconds: number) => void
}

export async function analyseTitle(
  mediaType: 'movie' | 'series',
  mediaId: string,
  subject: AnalysisSubject,
  options: AnalyseTitleOptions = {}
): Promise<StoredAnalysis> {
  // The readiness check is on the EXECUTION path, not just the settings page.
  // It existed from the start and was called only by the settings handler, to
  // render a badge — so it described the configuration without ever governing
  // it. What that permitted, measured live: retrieval mode left on `grounding`
  // while the role pointed at an OpenRouter model, which cannot ground. The run
  // logged `webSearchQueries: 0, groundingChunks: 0`, the model wrote 8,023
  // characters out of its own memory, the floor correctly called it
  // `thin_sources` — and the decline was stored, retiring the title until
  // ANALYSIS_PROMPT_VERSION moves. Left alone it would have walked the library
  // writing permanent declines at roughly a title a minute, never once
  // contacting the retrieval service. A guard nothing calls is a comment.
  const readiness = await checkModeReadiness()
  if (!readiness.ready) {
    throw new Error(readiness.reason ?? 'Title analysis is not configured')
  }
  const mode = readiness.mode

  // Resolved ONCE, above both prompt builds and the row that records it, so the
  // prompt that was sent and the prompt the row names cannot disagree. Null is
  // the ordinary answer and means the current version's own questions and
  // rules; see ./promptSetting.ts for the two ways a stored id resolves to it.
  const promptVariant = await getAnalysisPromptVariant()

  // Read in both modes. The output ceiling is a property of the model, not of
  // the retrieval service, but it lives on the same settings card as
  // sourceBudgetChars because how much text goes in and how much may come out
  // are one decision about one context window.
  const crwConfig = await getCrwConfig()

  let text: string
  let mapText: string | null
  let grade: SourceGrade | null
  let problem: ResponseProblem | null
  let modelId: string
  let finishReason: string | undefined
  let usage: AnalysisUsage | undefined
  let maxOutputTokens: number | undefined
  let evidence: RetrievalEvidence
  let foundSources: AnalysisSourceRef[]
  let sourceCount: number
  let retrievedChars: number | null

  if (mode === 'grounding') {
    // The model searches for itself. Nothing to budget and nothing to fence —
    // no external text enters the prompt — but also far less to judge the
    // result on, which is why the floor leans on the model's own verdict here.
    const result = await writeWithGrounding(
      buildAnalysisPrompt(subject, { mode, variant: promptVariant }),
      crwConfig.analysisMaxOutputTokens,
      {
        mediaType,
        shouldCancel: options.shouldCancel,
        onWait: options.onWait,
        title: subject.title,
      }
    )

    // A grounded call that retrieved NOTHING did not answer the question — it
    // answered from memory, which is the one thing this feature exists to
    // prevent. That is a retrieval failure, so it throws and leaves the title
    // pending, exactly as `retrieveSources` does when the metasearch comes back
    // empty. Storing it as a thin-sources decline would be permanent, and would
    // be recording "the web has little on this film" on the strength of a
    // search that never happened. The two branches now fail the same way; the
    // grounding one silently did not, which is what turned a misconfiguration
    // into data loss rather than an error.
    if ((result.groundingChunks ?? 0) === 0) {
      throw new Error(
        `Grounded analysis retrieved no sources for "${subject.title}" — the model answered without searching. ` +
          `Check that the Title Analysis role is on a Google model that supports search grounding, and that its quota is not exhausted.`
      )
    }

    text = result.text
    mapText = result.mapText
    grade = result.grade
    problem = result.problem
    modelId = result.modelId
    finishReason = result.finishReason
    usage = result.usage
    maxOutputTokens = result.maxOutputTokens
    evidence = { mode: 'grounding', chunkCount: result.groundingChunks ?? 0 }
    foundSources = result.groundingSources ?? []
    sourceCount = result.groundingChunks ?? 0
    // Google never exposes the retrieved text, so there is no character count
    // to record. NULL means "not measurable in this mode", not zero.
    retrievedChars = null
  } else {
    const retrieval = await retrieveSources(subject)

    // The seam. Retrieval is the long half and the model call is about to be
    // the other one, so a Stop pressed during the fetch takes effect here
    // rather than after another few thousand tokens of inference.
    if (options.shouldCancel && (await options.shouldCancel()) === true) {
      throw new AnalysisCancelledError()
    }

    const result = await writeFromSources(
      buildAnalysisPrompt(subject, { mode, sources: retrieval.sources, variant: promptVariant }),
      crwConfig.analysisMaxOutputTokens,
      {
        mediaType,
        shouldCancel: options.shouldCancel,
        onWait: options.onWait,
        title: subject.title,
      }
    )
    text = result.text
    mapText = result.mapText
    grade = result.grade
    problem = result.problem
    modelId = result.modelId
    finishReason = result.finishReason
    usage = result.usage
    maxOutputTokens = result.maxOutputTokens
    evidence = { mode: 'crw', sources: retrieval.evidence }
    foundSources = retrieval.sources.map((s) => ({
      title: s.title,
      domain: s.domain,
      ...(s.url ? { url: s.url } : {}),
    }))
    sourceCount = retrieval.sources.length
    retrievedChars = retrieval.retrievedChars
  }

  // A response that cannot be read as an answer THROWS rather than declining,
  // which leaves the row unwritten and the title pending. That asymmetry is the
  // whole point: a decline is permanent, and "the model did not follow the
  // output format" is a fact about the MODEL, so declining would retire the
  // library over a settings mistake - the OMDb-401 incident exactly. The
  // writers have already retried this several times by the time it gets here.
  if (problem) {
    logger.warn(
      {
        mediaType,
        mediaId,
        title: subject.title,
        mode,
        modelId,
        problem: problem.kind,
        finishReason,
        textChars: text.length,
        // The budget travels with the verdict. Without it `problem: truncated`
        // says a ceiling was hit and leaves the reader to go and find which.
        maxOutputTokens: maxOutputTokens ?? 'unlimited',
        ...(usage ?? {}),
      },
      'Analysis response was not an answer; leaving the title pending'
    )
    throw new Error(
      describeResponseProblem(problem, {
        title: subject.title,
        modelId,
        maxOutputTokens,
        outputTokens: usage?.outputTokens,
      })
    )
  }

  const decision = decideAnalysisFloor({ text, grade, evidence })

  const analysis = decision.store ? text : null
  const declineReason = decision.store ? null : decision.reason

  // Judged here because this is the only frame holding the media type, and
  // therefore the only one that knows which question labels the model was even
  // offered -- `structure` is series-only. Only for a kept analysis: a decline
  // stores no prose, so there would be nothing for the indices to point at.
  const paragraphMap = decision.store
    ? parseParagraphMap(mapText, {
        paragraphCount: splitAnalysisParagraphs(text).length,
        mediaType,
      })
    : null

  // The map is tolerant, which is exactly why losing one has to be AUDIBLE.
  // Both boot-time checks in this repo shipped silent on the unhappy path and
  // were indistinguishable from never having run; a map that quietly fails for
  // every title would look the same as a model that never writes one, and the
  // fixes are different -- a miscount is the model, an absence is the prompt or
  // a stale prompt_version.
  if (mapText && !paragraphMap && decision.store) {
    logger.warn(
      {
        mediaType,
        mediaId,
        title: subject.title,
        modelId,
        paragraphs: splitAnalysisParagraphs(text).length,
        mapText,
      },
      'Paragraph map did not validate; storing the analysis without it'
    )
  }

  // Provenance is stored for what we KEPT only: a declined row renders as
  // "we looked and there was nothing worth writing", and listing the pages that
  // produced nothing would invite a reader to go and check them.
  const storedSources = decision.store ? foundSources : []

  if (!decision.store) {
    logger.info(
      {
        mediaType,
        mediaId,
        title: subject.title,
        mode,
        reason: declineReason,
        grade,
        sourceCount,
        retrievedChars,
        domains: evidence.mode === 'crw' ? evidence.sources.map((s) => s.domain) : undefined,
        textChars: text.length,
      },
      'Title analysis declined; storing the decline so it is not re-asked'
    )
  }

  await query(
    `INSERT INTO title_analysis
       (media_type, media_id, analysis, decline_reason, sources, source_grade,
        source_count, retrieved_chars, model, retrieval_mode, paragraph_map,
        prompt_version, prompt_variant, analyzed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, NOW())
     ON CONFLICT (media_type, media_id) DO UPDATE SET
       analysis = EXCLUDED.analysis,
       decline_reason = EXCLUDED.decline_reason,
       sources = EXCLUDED.sources,
       source_grade = EXCLUDED.source_grade,
       source_count = EXCLUDED.source_count,
       retrieved_chars = EXCLUDED.retrieved_chars,
       model = EXCLUDED.model,
       retrieval_mode = EXCLUDED.retrieval_mode,
       paragraph_map = EXCLUDED.paragraph_map,
       prompt_version = EXCLUDED.prompt_version,
       prompt_variant = EXCLUDED.prompt_variant,
       analyzed_at = NOW(),
       -- A fresh analysis invalidates tags extracted from the previous prose.
       tags_prompt_version = NULL`,
    [
      mediaType,
      mediaId,
      analysis,
      declineReason,
      JSON.stringify(storedSources),
      grade,
      sourceCount,
      retrievedChars,
      modelId,
      mode,
      // NULL, not '[]'. "The model wrote no usable map" and "the map says this
      // analysis answers nothing" are different claims, and only the first is
      // true here -- an empty array would tell a later reader the questions
      // were checked and found unanswered.
      paragraphMap ? JSON.stringify(paragraphMap) : null,
      ANALYSIS_PROMPT_VERSION,
      // What actually wrote it, never what was configured: a stored id this
      // build cannot use resolved to null above, and the version's own prompt
      // wrote the row.
      promptVariant,
    ]
  )

  // THE LINE THAT SAYS A ROW NOW EXISTS, and its absence is what made a live
  // failure unreadable. Every other line on this path reports on WORK -- what
  // was retrieved, what the model said, whether the answer was usable -- and
  // the last of them, `Analysis written`, is about a response in memory. So a
  // run that wrote a fine analysis and then failed to store it looked exactly
  // like a run that stored one, and the only way to tell them apart was to go
  // and query the table. Now the log distinguishes them.
  //
  // `mapped` rides here rather than anywhere else because this is the first
  // point at which it is a fact about the DATABASE instead of about a response.
  logger.info(
    {
      mediaType,
      mediaId,
      title: subject.title,
      mode,
      modelId,
      stored: decision.store ? 'analysis' : 'decline',
      declineReason,
      chars: analysis?.length ?? 0,
      mapped: paragraphMap?.length ?? null,
      grade,
      sourceCount,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      promptVariant,
    },
    'Title analysis stored'
  )

  return {
    mediaType,
    mediaId,
    analysis,
    declineReason,
    sources: storedSources,
    sourceGrade: grade,
    sourceCount,
    retrievedChars,
    model: modelId,
    retrievalMode: mode,
    paragraphMap,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    promptVariant,
    analyzedAt: new Date().toISOString(),
  }
}
