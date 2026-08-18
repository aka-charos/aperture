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
import { generateText } from 'ai'

import {
  getGroundingProviderTools,
  getTitleAnalysisModelInstance,
  withGroundingModel,
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
import { createChildLogger } from '../lib/logger.js'
import { recordWebSearchCall } from '../lib/webSearchUsage.js'
import { budgetSources } from './budget.js'
import { checkModeReadiness, type RetrievalMode } from './mode.js'
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
  promptVersion: number
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
    prompt_version: number
    analyzed_at: Date
  }>(
    `SELECT analysis, decline_reason, sources, source_grade, source_count,
            retrieved_chars, model, retrieval_mode, prompt_version, analyzed_at
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
    promptVersion: row.prompt_version,
    analyzedAt: row.analyzed_at.toISOString(),
  }
}

interface Retrieval {
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
async function retrieveSources(subject: AnalysisSubject): Promise<Retrieval> {
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

  const fetched: AnalysisSource[] = response.results.map((r) => ({
    title: r.title,
    domain: r.domain,
    text: r.markdown,
    url: r.url,
  }))

  const fetchedChars = fetched.reduce((sum, s) => sum + s.text.length, 0)
  if (fetchedChars === 0) {
    throw new Error(
      `Retrieval returned ${response.results.length} result(s) but no page text — check the scraper.${reported}`
    )
  }

  const sources = budgetSources(fetched, { budget: config.sourceBudgetChars })
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
      results: response.results.length,
      fetchedChars,
      budgeted: sources.length,
      retrievedChars,
      domains: sources.map((s) => s.domain),
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

interface WriteResult {
  /** The prose, already unwrapped from the contract. */
  text: string
  /** The closing grade, or null when the model omitted it. */
  grade: SourceGrade | null
  /** Why the response is unusable, or null when it reads as an answer. */
  problem: ResponseProblem | null
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
function readAnalysis(raw: string, finishReason?: string) {
  const parsed = parseAnalysisResponse(stripReasoningBlocks(raw))
  return {
    text: parsed.text,
    grade: parsed.grade,
    problem: findResponseProblem({
      text: parsed.text,
      grade: parsed.grade,
      hadBeginMarker: parsed.hadBeginMarker,
      finishReason,
    }),
  }
}

/** One plain writing call over documents already in the prompt. */
async function writeFromSources(prompt: string, maxOutputTokens: number): Promise<WriteResult> {
  const { model, modelId } = await getTitleAnalysisModelInstance()

  // The other silent half. A local model chewing through ~18k tokens of article
  // text is minutes of wall clock with nothing to show for it, and on a
  // self-hosted setup this is the step most likely to be the slow one - so the
  // model id, the prompt size and the output ceiling are logged before the
  // call, not just after. Together with the retrieval line above, every long
  // pause in a run now has a log line saying which of the two services owns it.
  logger.info(
    { modelId, promptChars: prompt.length, maxOutputTokens: maxOutputTokens || 'unlimited' },
    'Writing analysis'
  )
  const startedAt = Date.now()

  let reading = { text: '', grade: null as SourceGrade | null, problem: null as ResponseProblem | null }
  let finishReason: string | undefined

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const response = await generateText({
      model,
      prompt,
      maxRetries: MODEL_MAX_RETRIES,
      // 0 means the operator asked for no ceiling, so none is sent and the
      // provider default applies.
      ...(maxOutputTokens > 0 ? { maxOutputTokens } : {}),
    })
    finishReason = response.finishReason
    reading = readAnalysis(response.text ?? '', response.finishReason)

    if (!reading.problem) break
    if (attempt < MAX_WRITE_ATTEMPTS) {
      logger.warn(
        { attempt, modelId, problem: reading.problem.kind, finishReason },
        'Analysis response was not usable; retrying'
      )
      await sleep(RETRY_DELAY_MS)
    }
  }

  logger.info(
    {
      modelId,
      textChars: reading.text.length,
      grade: reading.grade,
      problem: reading.problem?.kind,
      finishReason,
      ms: Date.now() - startedAt,
    },
    'Analysis written'
  )

  return { ...reading, modelId, finishReason }
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
  maxOutputTokens: number
): Promise<WriteResult> {
  const tools = await getGroundingProviderTools('titleAnalysis')

  return withGroundingModel('titleAnalysis', async (model, keyAttempt) => {
    let result: WriteResult = {
      text: '',
      grade: null,
      problem: null,
      modelId: keyAttempt.modelId,
    }
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined

    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      const response = await generateText({
        model,
        tools,
        prompt,
        maxRetries: MODEL_MAX_RETRIES,
        ...(maxOutputTokens > 0 ? { maxOutputTokens } : {}),
      })
      usage = response.usage

      const grounding = (
        response.providerMetadata?.google as
          | { groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: unknown[] } }
          | undefined
      )?.groundingMetadata

      const reading = readAnalysis(response.text ?? '', response.finishReason)
      result = {
        ...reading,
        modelId: response.response?.modelId ?? keyAttempt.modelId,
        finishReason: response.finishReason,
        groundingChunks: grounding?.groundingChunks?.length ?? 0,
        groundingSources: extractGroundingSources(response.sources),
      }

      logger.info(
        {
          attempt,
          keySlot: keyAttempt.slot,
          modelId: result.modelId,
          webSearchQueries: grounding?.webSearchQueries?.length ?? 0,
          groundingChunks: result.groundingChunks,
          textChars: result.text.length,
          problem: result.problem?.kind,
        },
        'Title analysis grounding completed'
      )

      if (!result.problem) break

      if (attempt < MAX_WRITE_ATTEMPTS) {
        logger.warn({ attempt, problem: result.problem.kind }, 'Grounded analysis unusable; retrying')
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

  // Read in both modes. The output ceiling is a property of the model, not of
  // the retrieval service, but it lives on the same settings card as
  // sourceBudgetChars because how much text goes in and how much may come out
  // are one decision about one context window.
  const crwConfig = await getCrwConfig()

  let text: string
  let grade: SourceGrade | null
  let problem: ResponseProblem | null
  let modelId: string
  let finishReason: string | undefined
  let evidence: RetrievalEvidence
  let foundSources: AnalysisSourceRef[]
  let sourceCount: number
  let retrievedChars: number | null

  if (mode === 'grounding') {
    // The model searches for itself. Nothing to budget and nothing to fence —
    // no external text enters the prompt — but also far less to judge the
    // result on, which is why the floor leans on the model's own verdict here.
    const result = await writeWithGrounding(
      buildAnalysisPrompt(subject, { mode }),
      crwConfig.analysisMaxOutputTokens
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
    grade = result.grade
    problem = result.problem
    modelId = result.modelId
    finishReason = result.finishReason
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
      buildAnalysisPrompt(subject, { mode, sources: retrieval.sources }),
      crwConfig.analysisMaxOutputTokens
    )
    text = result.text
    grade = result.grade
    problem = result.problem
    modelId = result.modelId
    finishReason = result.finishReason
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
      },
      'Analysis response was not an answer; leaving the title pending'
    )
    throw new Error(describeResponseProblem(problem, { title: subject.title, modelId }))
  }

  const decision = decideAnalysisFloor({ text, grade, evidence })

  const analysis = decision.store ? text : null
  const declineReason = decision.store ? null : decision.reason

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
        source_count, retrieved_chars, model, retrieval_mode, prompt_version, analyzed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (media_type, media_id) DO UPDATE SET
       analysis = EXCLUDED.analysis,
       decline_reason = EXCLUDED.decline_reason,
       sources = EXCLUDED.sources,
       source_grade = EXCLUDED.source_grade,
       source_count = EXCLUDED.source_count,
       retrieved_chars = EXCLUDED.retrieved_chars,
       model = EXCLUDED.model,
       retrieval_mode = EXCLUDED.retrieval_mode,
       prompt_version = EXCLUDED.prompt_version,
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
      ANALYSIS_PROMPT_VERSION,
    ]
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
    promptVersion: ANALYSIS_PROMPT_VERSION,
    analyzedAt: new Date().toISOString(),
  }
}
