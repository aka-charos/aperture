/**
 * Google grounding web-search source.
 *
 * The Web Search role model (Gemini) with the provider-native google_search
 * tool: an LLM that searches AND reasons, emitting grounded free-text
 * suggestions with a "why" for each title. Enabled simply by configuring the
 * Web Search role; disabled (returns null) when that role is unconfigured.
 *
 * This call gets the task instructions and the user's question, and NOTHING
 * about the viewer. That is deliberate and was learned the hard way: the taste
 * profile used to sit in the system message under an explicit "do not search
 * for the titles in it" rule, and a request reading "suggest me french film
 * noir movies based on my history" produced twelve search queries, every one of
 * them "French film noir" plus a descriptor of the user's favourite Lynch film
 * — one of them naming the film outright. An instruction is not a boundary, and
 * it loses to the user's own wording whenever they ask for personalisation.
 *
 * Personalisation therefore happens AFTER retrieval, in the structuring pass
 * (webCandidates.ts), which ranks and selects among titles the search already
 * returned. A model that never receives the profile cannot search on it.
 *
 * Grounding has a tight per-minute quota, so back-to-back queries can 429 or
 * return empty text. We (a) set an explicit SDK maxRetries so 429/5xx get real
 * backoff, (b) retry once when grounding returns empty text (a 200 the SDK never
 * retries), (c) run through withWebSearchModel, which moves to the role's
 * fallback API key when the first one is out of free-tier quota and meters every
 * call, and (d) record hard failures via recordLlmError (logs + api_errors under
 * 'google') instead of swallowing them.
 */
import { generateText } from 'ai'
import {
  withWebSearchModel,
  getWebSearchProviderTools,
  createChildLogger,
  recordWebSearchCall,
} from '@aperture/core'
import { recordLlmError } from '../../helpers/errors.js'
import type { WebSearchSource, WebSearchSourceResult } from './types.js'

const logger = createChildLogger('web-source-google')

/** SDK-level retries (exp backoff) for 429/5xx on the grounding call. */
const SDK_MAX_RETRIES = 3
/** Extra attempts when grounding returns empty text (a 200 the SDK won't retry). */
const PASS1_MAX_ATTEMPTS = 2
const PASS1_RETRY_DELAY_MS = 800

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Task instructions only. The user's message carries the request ALONE, so the
 * thing being searched for is the thing they typed — see the note at the top of
 * this file for why nothing about the viewer belongs here.
 */
const GROUNDING_SYSTEM =
  "Using current web information, list up to 12 specific movies or TV series that best answer the user's request. " +
  'For EACH title you MUST provide: the exact title, the release year, whether it is a movie or a series, and — most importantly — one or two sentences on WHY it fits this specific request. ' +
  'The "why" is mandatory for every title and must be CONCRETE and SPECIFIC: the shared structural device, the tonal or thematic link, how the filmmaker themselves framed it, the precise thing it has in common. ' +
  'Write it directly, not as hedged reportage — prefer "same fragmented structure where identities blur" over "is often described as similar". No generic praise. A title with no real reason is useless: omit it rather than list it without one. ' +
  'Include the IMDb id (tt…) or TMDb id ONLY if it appears in a source you actually used; otherwise omit it.'

export const googleGroundingSource: WebSearchSource = {
  id: 'google',
  async gather(query: string): Promise<WebSearchSourceResult | null> {
    try {
      const tools = await getWebSearchProviderTools()

      // The empty-text retry sits INSIDE the key loop: an empty response is a
      // soft refusal worth retrying on the same key, whereas a 429 means this
      // key is done and withWebSearchModel should move to the next one.
      const text = await withWebSearchModel(async (model, keyAttempt) => {
        let text = ''
        let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined

        for (let attempt = 1; attempt <= PASS1_MAX_ATTEMPTS; attempt++) {
          const pass1 = await generateText({
            model,
            tools,
            maxRetries: SDK_MAX_RETRIES,
            system: GROUNDING_SYSTEM,
            prompt: query,
          })
          text = pass1.text ?? ''
          usage = pass1.usage

          // Observability: prove grounding actually ran — the search queries Google
          // issued and how many web sources came back (grep "web-source-google").
          const grounding = (
            pass1.providerMetadata?.google as
              | { groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: unknown[] } }
              | undefined
          )?.groundingMetadata
          // The task instructions live in the system message, so a provider that
          // silently drops it would leave this call with nothing but the user's
          // question — free prose instead of a title list, and a structuring
          // pass fed garbage. The SDK reports that as an unsupported-setting
          // warning, which is worth its own line rather than a field nobody
          // reads. Empty on every healthy call.
          if (pass1.warnings?.length) {
            logger.warn(
              { warnings: pass1.warnings, modelId: pass1.response?.modelId },
              'Google grounding returned provider warnings'
            )
          }
          logger.info(
            {
              attempt,
              keySlot: keyAttempt.slot,
              // Which model actually served this — the Web Search role is
              // configurable and its free-tier models differ in what they
              // support, so "it worked on mine" is not a useful record.
              modelId: pass1.response?.modelId,
              webSearchQueries: grounding?.webSearchQueries ?? [],
              groundingChunks: grounding?.groundingChunks?.length ?? 0,
              sources: pass1.sources?.length ?? 0,
              textChars: text.length,
            },
            'Google grounding completed'
          )

          if (text.trim()) break
          if (attempt < PASS1_MAX_ATTEMPTS) {
            logger.warn({ attempt }, 'Google grounding returned empty text; retrying')
            // Meter the attempt we are about to throw away. withWebSearchModel
            // records once per KEY attempt and this retry loop lives inside one
            // of those, so without this the second request is invisible to the
            // meter while Google still counts it against the daily quota. Only
            // the retried attempts are recorded here — the wrapper still records
            // the final one, so the totals add up exactly.
            await recordWebSearchCall({
              provider: keyAttempt.provider,
              model: keyAttempt.modelId,
              slot: keyAttempt.slot,
              status: 'empty',
              ...pass1.usage,
            })
            await sleep(PASS1_RETRY_DELAY_MS)
          }
        }

        return { value: text, usage }
      })

      if (!text.trim()) {
        logger.warn(
          { query: query.slice(0, 120) },
          'Google grounding returned no text after retries; contributing nothing'
        )
        return null
      }

      return { source: 'google', text }
    } catch (err) {
      // Web Search role not configured — this source is simply off, not broken.
      if (err instanceof Error && /is not configured/i.test(err.message)) return null

      // Hard failure (429 on every key, safety, 5xx) — recorded under the 'google'
      // provider so it shows in logs AND the admin API-errors panel. Fail open to null.
      await recordLlmError(err, { context: 'discovery web search (google)', provider: 'google', logger })
      return null
    }
  },
}
