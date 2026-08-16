/**
 * Generate and store one title's grounded analysis.
 *
 * Mirrors `assistant/discovery/sources/googleGrounding.ts` closely, because
 * that file is where this repo's grounding lessons already live: explicit SDK
 * retries so 429/5xx get real backoff, a retry for the empty-text soft refusal
 * that a 200 never triggers, and — the one that was a bug for a while — METERING
 * THAT RETRY, since `withGroundingModel` records once per key attempt while the
 * empty-text loop sits inside one of those. Without it, a request Google counts
 * against the daily quota is invisible to the meter.
 *
 * What is different here: this runs on the `titleAnalysis` role, so it spends a
 * different key from the assistant's discovery. That separation is the entire
 * reason the role exists — a batch walking 13,000 titles would otherwise
 * exhaust the grounding cap chat depends on.
 */
import { generateText } from 'ai'

import { getGroundingProviderTools, withGroundingModel } from '../lib/ai-provider.js'
import { recordWebSearchCall } from '../lib/webSearchUsage.js'
import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import {
  ANALYSIS_PROMPT_VERSION,
  buildAnalysisPrompt,
  parseAnalysisResponse,
  type AnalysisSubject,
} from './prompt.js'
import { decideAnalysisFloor } from './sourceFloor.js'

const logger = createChildLogger('title-analysis')

/** SDK-level retries (exponential backoff) for 429/5xx. */
const SDK_MAX_RETRIES = 3
/** Extra attempts when grounding returns empty text — a 200 the SDK won't retry. */
const MAX_EMPTY_RETRIES = 2
const EMPTY_RETRY_DELAY_MS = 800

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface StoredAnalysis {
  mediaType: 'movie' | 'series'
  mediaId: string
  analysis: string | null
  declineReason: string | null
  sources: Array<{ title: string; domain: string }>
  sourceGrade: string | null
  groundingChunks: number | null
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
    grounding_chunks: number | null
    model: string | null
    prompt_version: number
    analyzed_at: Date
  }>(
    `SELECT analysis, decline_reason, sources, source_grade, grounding_chunks,
            model, prompt_version, analyzed_at
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
    groundingChunks: row.grounding_chunks,
    model: row.model,
    promptVersion: row.prompt_version,
    analyzedAt: row.analyzed_at.toISOString(),
  }
}

/**
 * Turn the SDK's grounding sources into something worth storing.
 *
 * Deliberately drops the URL. Google returns `vertexaisearch.../
 * grounding-api-redirect/...` links that expire, so a cache meant to live for
 * months would fill with dead links — the domain is the durable, useful part
 * (it is what tells a reader whether this came from Senses of Cinema or a
 * listicle), and the title identifies the piece.
 */
function extractSources(raw: unknown): Array<{ title: string; domain: string }> {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Array<{ title: string; domain: string }> = []

  for (const entry of raw) {
    const source = entry as { title?: unknown; url?: unknown }
    const url = typeof source.url === 'string' ? source.url : null
    const title = typeof source.title === 'string' ? source.title.trim() : ''
    let domain = ''
    if (url) {
      try {
        domain = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        domain = ''
      }
    }
    // A redirect host is not provenance — it is the same for every source, so
    // showing it would tell the reader nothing.
    if (domain.includes('vertexaisearch') || domain.includes('grounding-api')) domain = ''
    if (!title && !domain) continue

    const key = `${title}|${domain}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ title: title || domain, domain })
  }

  return out
}

interface GroundedResponse {
  text: string
  groundingChunks: number
  sources: Array<{ title: string; domain: string }>
  modelId: string | null
}

/** One grounded call, with the empty-text retry metered. */
async function runGroundedAnalysis(prompt: string): Promise<GroundedResponse> {
  const tools = await getGroundingProviderTools('titleAnalysis')

  return withGroundingModel('titleAnalysis', async (model, keyAttempt) => {
    let result: GroundedResponse = {
      text: '',
      groundingChunks: 0,
      sources: [],
      modelId: null,
    }
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined

    for (let attempt = 1; attempt <= MAX_EMPTY_RETRIES; attempt++) {
      const response = await generateText({
        model,
        tools,
        maxRetries: SDK_MAX_RETRIES,
        prompt,
      })
      usage = response.usage

      const grounding = (
        response.providerMetadata?.google as
          | { groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: unknown[] } }
          | undefined
      )?.groundingMetadata

      result = {
        text: response.text ?? '',
        groundingChunks: grounding?.groundingChunks?.length ?? 0,
        sources: extractSources(response.sources),
        modelId: response.response?.modelId ?? null,
      }

      logger.info(
        {
          attempt,
          keySlot: keyAttempt.slot,
          modelId: result.modelId,
          webSearchQueries: grounding?.webSearchQueries?.length ?? 0,
          groundingChunks: result.groundingChunks,
          sources: result.sources.length,
          textChars: result.text.length,
        },
        'Title analysis grounding completed'
      )

      if (result.text.trim()) break

      if (attempt < MAX_EMPTY_RETRIES) {
        logger.warn({ attempt }, 'Title analysis returned empty text; retrying')
        // Meter the attempt we are about to throw away. withGroundingModel
        // records once per KEY attempt and this loop lives inside one of them,
        // so without this the second request is invisible to the meter while
        // Google still counts it against the daily quota.
        await recordWebSearchCall({
          role: 'titleAnalysis',
          provider: keyAttempt.provider,
          model: keyAttempt.modelId,
          slot: keyAttempt.slot,
          status: 'empty',
          ...response.usage,
        })
        await sleep(EMPTY_RETRY_DELAY_MS)
      }
    }

    return { value: result, usage }
  })
}

/**
 * Analyse one title and store the outcome.
 *
 * Returns the stored row on success OR decline — both are results. Throws on a
 * transport failure, which is what keeps the title pending: no row is written,
 * so the next run picks it up again. Callers that batch must let the throw
 * through (and count the attempt) rather than converting it into a stored
 * decline, or a transient 429 would retire a title permanently. That is exactly
 * the mistake that let a run of OMDb 401s stamp an entire library complete.
 */
export async function analyseTitle(
  mediaType: 'movie' | 'series',
  mediaId: string,
  subject: AnalysisSubject
): Promise<StoredAnalysis> {
  const prompt = buildAnalysisPrompt(subject)
  const response = await runGroundedAnalysis(prompt)

  const { text, grade } = parseAnalysisResponse(response.text)
  const decision = decideAnalysisFloor({
    text,
    grade,
    groundingChunks: response.groundingChunks,
  })

  const analysis = decision.store ? text : null
  const declineReason = decision.store ? null : decision.reason

  if (!decision.store) {
    logger.info(
      {
        mediaType,
        mediaId,
        title: subject.title,
        reason: declineReason,
        grade,
        groundingChunks: response.groundingChunks,
        textChars: text.length,
      },
      'Title analysis declined; storing the decline so it is not re-asked'
    )
  }

  await query(
    `INSERT INTO title_analysis
       (media_type, media_id, analysis, decline_reason, sources, source_grade,
        grounding_chunks, model, prompt_version, analyzed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, NOW())
     ON CONFLICT (media_type, media_id) DO UPDATE SET
       analysis = EXCLUDED.analysis,
       decline_reason = EXCLUDED.decline_reason,
       sources = EXCLUDED.sources,
       source_grade = EXCLUDED.source_grade,
       grounding_chunks = EXCLUDED.grounding_chunks,
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
      JSON.stringify(decision.store ? response.sources : []),
      grade,
      response.groundingChunks,
      response.modelId,
      ANALYSIS_PROMPT_VERSION,
    ]
  )

  return {
    mediaType,
    mediaId,
    analysis,
    declineReason,
    sources: decision.store ? response.sources : [],
    sourceGrade: grade,
    groundingChunks: response.groundingChunks,
    model: response.modelId,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    analyzedAt: new Date().toISOString(),
  }
}
