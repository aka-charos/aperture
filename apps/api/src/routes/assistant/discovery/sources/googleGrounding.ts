/**
 * Google grounding web-search source.
 *
 * The Web Search role model (Gemini) with the provider-native google_search
 * tool: an LLM that searches AND reasons, emitting grounded free-text
 * suggestions with a "why" for each title. Enabled simply by configuring the
 * Web Search role; disabled (returns null) when that role is unconfigured.
 *
 * Grounding has a tight per-minute quota, so back-to-back queries can 429 or
 * return empty text. We (a) set an explicit SDK maxRetries so 429/5xx get real
 * backoff, (b) retry once when grounding returns empty text (a 200 the SDK never
 * retries), and (c) record hard failures via recordLlmError (logs + api_errors
 * under 'google') instead of swallowing them.
 */
import { generateText, type LanguageModel } from 'ai'
import {
  getWebSearchModelInstance,
  getWebSearchProviderTools,
  createChildLogger,
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

const groundingPrompt = (query: string): string =>
  'Using current web information, list up to 12 specific movies or TV series that best answer this request. ' +
  'For EACH title you MUST provide: the exact title, the release year, whether it is a movie or a series, and — most importantly — one or two sentences on WHY it fits this specific request. ' +
  'The "why" is mandatory for every title and should be concrete (tone, theme, what it shares with the request), not generic praise. A title with no reason is useless — omit it rather than list it without a reason. ' +
  'Include the IMDb id (tt…) or TMDb id ONLY if it appears in a source you actually used; otherwise omit it.\n\n' +
  `Request: ${query}`

export const googleGroundingSource: WebSearchSource = {
  id: 'google',
  async gather(query: string): Promise<WebSearchSourceResult | null> {
    let model: LanguageModel
    try {
      model = await getWebSearchModelInstance()
    } catch {
      // Web Search role not configured — this source is simply off.
      return null
    }

    try {
      const tools = await getWebSearchProviderTools()

      // Retry when the grounded response comes back empty (a soft rate-limit /
      // safety refusal returns a 200 with no text, which the SDK never retries).
      let text = ''
      for (let attempt = 1; attempt <= PASS1_MAX_ATTEMPTS; attempt++) {
        const pass1 = await generateText({
          model,
          tools,
          maxRetries: SDK_MAX_RETRIES,
          prompt: groundingPrompt(query),
        })
        text = pass1.text ?? ''

        // Observability: prove grounding actually ran — the search queries Google
        // issued and how many web sources came back (grep "web-source-google").
        const grounding = (
          pass1.providerMetadata?.google as
            | { groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: unknown[] } }
            | undefined
        )?.groundingMetadata
        logger.info(
          {
            attempt,
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
          await sleep(PASS1_RETRY_DELAY_MS)
        }
      }

      if (!text.trim()) {
        logger.warn(
          { query: query.slice(0, 120) },
          'Google grounding returned no text after retries; contributing nothing'
        )
        return null
      }

      return { source: 'google', text }
    } catch (err) {
      // Hard failure (429, safety, 5xx) — recorded under the 'google' provider so
      // it shows in logs AND the admin API-errors panel. Fail open to null.
      await recordLlmError(err, { context: 'discovery web search (google)', provider: 'google', logger })
      return null
    }
  },
}
