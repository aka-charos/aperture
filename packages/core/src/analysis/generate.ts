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

import { getTitleAnalysisModelInstance } from '../lib/ai-provider.js'
import { crwSearch, getCrwConfig, isCrwEnabled } from '../lib/crw.js'
import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { budgetSources } from './budget.js'
import {
  ANALYSIS_PROMPT_VERSION,
  buildAnalysisPrompt,
  buildAnalysisQuery,
  parseAnalysisResponse,
  type AnalysisSource,
  type AnalysisSubject,
} from './prompt.js'
import { decideAnalysisFloor, type RetrievedSource } from './sourceFloor.js'

const logger = createChildLogger('title-analysis')

/** Retries for a transport blip talking to the model. */
const MODEL_MAX_RETRIES = 2
/** Extra attempts when the model returns empty text — a 200 the SDK won't retry. */
const MAX_EMPTY_RETRIES = 2
const EMPTY_RETRY_DELAY_MS = 500

/**
 * Ceiling on the answer. The prompt asks for length to follow the work (200
 * words is often right), so this is a bound on a runaway local model rather
 * than a target — generous enough that the ~900-word case is never clipped.
 */
const MAX_OUTPUT_TOKENS = 2000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface StoredAnalysis {
  mediaType: 'movie' | 'series'
  mediaId: string
  analysis: string | null
  declineReason: string | null
  sources: Array<{ title: string; domain: string }>
  sourceGrade: string | null
  sourceCount: number | null
  retrievedChars: number | null
  model: string | null
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
    sources: Array<{ title: string; domain: string }> | null
    source_grade: string | null
    source_count: number | null
    retrieved_chars: number | null
    model: string | null
    prompt_version: number
    analyzed_at: Date
  }>(
    `SELECT analysis, decline_reason, sources, source_grade, source_count,
            retrieved_chars, model, prompt_version, analyzed_at
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
  const response = await crwSearch(queryText, {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    maxResults: config.maxResults,
    maxContentChars: config.maxContentChars,
    timeoutMs: config.timeoutMs,
  })

  if (response.results.length === 0) {
    throw new Error(`Retrieval returned no results for "${queryText}"`)
  }

  const fetched: AnalysisSource[] = response.results.map((r) => ({
    title: r.title,
    domain: r.domain,
    text: r.markdown,
  }))

  const fetchedChars = fetched.reduce((sum, s) => sum + s.text.length, 0)
  if (fetchedChars === 0) {
    throw new Error(
      `Retrieval returned ${response.results.length} result(s) but no page text — check the scraper`
    )
  }

  const sources = budgetSources(fetched, { budget: config.sourceBudgetChars })
  const retrievedChars = sources.reduce((sum, s) => sum + s.text.length, 0)

  logger.debug(
    {
      title: subject.title,
      results: response.results.length,
      fetchedChars,
      budgeted: sources.length,
      retrievedChars,
    },
    'Retrieved sources for analysis'
  )

  return {
    sources,
    evidence: sources.map((s) => ({ domain: s.domain, chars: s.text.length })),
    retrievedChars,
  }
}

/** One writing call, with a retry for empty output. */
async function writeAnalysis(prompt: string): Promise<{ text: string; modelId: string }> {
  const { model, modelId } = await getTitleAnalysisModelInstance()

  let text = ''
  for (let attempt = 1; attempt <= MAX_EMPTY_RETRIES; attempt++) {
    const response = await generateText({
      model,
      prompt,
      maxRetries: MODEL_MAX_RETRIES,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
    text = response.text ?? ''

    if (text.trim()) break
    if (attempt < MAX_EMPTY_RETRIES) {
      logger.warn({ attempt, modelId }, 'Analysis model returned empty text; retrying')
      await sleep(EMPTY_RETRY_DELAY_MS)
    }
  }

  return { text, modelId }
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
export async function analyseTitle(
  mediaType: 'movie' | 'series',
  mediaId: string,
  subject: AnalysisSubject
): Promise<StoredAnalysis> {
  const retrieval = await retrieveSources(subject)
  const prompt = buildAnalysisPrompt(subject, retrieval.sources)
  const { text: raw, modelId } = await writeAnalysis(prompt)

  const { text, grade } = parseAnalysisResponse(raw)
  const decision = decideAnalysisFloor({ text, grade, sources: retrieval.evidence })

  const analysis = decision.store ? text : null
  const declineReason = decision.store ? null : decision.reason
  const sourceCount = retrieval.sources.length

  // Provenance is stored for what we KEPT only: a declined row renders as
  // "we looked and there was nothing worth writing", and listing the pages that
  // produced nothing would invite a reader to go and check them.
  const storedSources = decision.store
    ? retrieval.sources.map((s) => ({ title: s.title, domain: s.domain }))
    : []

  if (!decision.store) {
    logger.info(
      {
        mediaType,
        mediaId,
        title: subject.title,
        reason: declineReason,
        grade,
        sourceCount,
        retrievedChars: retrieval.retrievedChars,
        domains: retrieval.evidence.map((s) => s.domain),
        textChars: text.length,
      },
      'Title analysis declined; storing the decline so it is not re-asked'
    )
  }

  await query(
    `INSERT INTO title_analysis
       (media_type, media_id, analysis, decline_reason, sources, source_grade,
        source_count, retrieved_chars, model, prompt_version, analyzed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (media_type, media_id) DO UPDATE SET
       analysis = EXCLUDED.analysis,
       decline_reason = EXCLUDED.decline_reason,
       sources = EXCLUDED.sources,
       source_grade = EXCLUDED.source_grade,
       source_count = EXCLUDED.source_count,
       retrieved_chars = EXCLUDED.retrieved_chars,
       model = EXCLUDED.model,
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
      retrieval.retrievedChars,
      modelId,
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
    retrievedChars: retrieval.retrievedChars,
    model: modelId,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    analyzedAt: new Date().toISOString(),
  }
}
