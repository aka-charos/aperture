/**
 * Google grounding web-search source.
 *
 * The Web Search role model (Gemini) with the provider-native google_search
 * tool: an LLM that searches AND reasons, emitting grounded free-text
 * suggestions with a "why" for each title. Enabled simply by configuring the
 * Web Search role; disabled (returns null) when that role is unconfigured.
 *
 * TWO CHANNELS, deliberately: the task instructions and the viewer profile go
 * in the SYSTEM message, and the user's question is the ENTIRE user message.
 * The model formulates its own search queries from what it is given, so the
 * request has to be the only thing sitting where a request goes. This is not a
 * hard boundary — a system message is still context, and Gemini can search on
 * anything in it — which is why the profile also carries an explicit "do not
 * search for these" rule. Steer the selection, never the retrieval.
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
import { withWebSearchModel, getWebSearchProviderTools, createChildLogger } from '@aperture/core'
import { recordLlmError } from '../../helpers/errors.js'
import type { WebSearchSource, WebSearchSourceResult, WebSearchContext } from './types.js'

const logger = createChildLogger('web-source-google')

/** SDK-level retries (exp backoff) for 429/5xx on the grounding call. */
const SDK_MAX_RETRIES = 3
/** Extra attempts when grounding returns empty text (a 200 the SDK won't retry). */
const PASS1_MAX_ATTEMPTS = 2
const PASS1_RETRY_DELAY_MS = 800

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Viewer context, for the SYSTEM message.
 *
 * The rule that matters is the first one: the profile must never become a
 * search term. Retrieval answers the question the user asked; this exists only
 * to judge what comes back. Everything used to sit in one user message
 * alongside the request, which put the two on equal footing exactly when the
 * model was deciding what to search for.
 *
 * The precedence line stays, and stays explicit: leave it unstated and "find me
 * a good horror film" starts returning the arthouse dramas the profile is full
 * of — personalisation that quietly overrides the question is worse than none.
 */
const viewerBlock = (tasteBrief: string): string =>
  '\n\nABOUT THE VIEWER THIS IS FOR:\n' +
  tasteBrief +
  '\n\nUse this profile ONLY to choose between and rank titles that already answer the ' +
  'request equally well, and to avoid offering things they have plainly already seen. ' +
  'Do NOT search for the titles or names in it, and do NOT add them to your search ' +
  'queries: search for what the user asked and nothing else. The profile must NEVER ' +
  'override the request — if the two conflict, the request wins outright.'

/**
 * Task instructions and viewer context. The user's message carries the request
 * ALONE, so the thing being searched for is the thing they typed.
 */
const groundingSystem = (tasteBrief?: string | null): string =>
  "Using current web information, list up to 12 specific movies or TV series that best answer the user's request. " +
  'For EACH title you MUST provide: the exact title, the release year, whether it is a movie or a series, and — most importantly — one or two sentences on WHY it fits this specific request. ' +
  'The "why" is mandatory for every title and must be CONCRETE and SPECIFIC: the shared structural device, the tonal or thematic link, how the filmmaker themselves framed it, the precise thing it has in common. ' +
  'Write it directly, not as hedged reportage — prefer "same fragmented structure where identities blur" over "is often described as similar". No generic praise. A title with no real reason is useless: omit it rather than list it without one. ' +
  'Include the IMDb id (tt…) or TMDb id ONLY if it appears in a source you actually used; otherwise omit it.' +
  (tasteBrief?.trim() ? viewerBlock(tasteBrief) : '')

export const googleGroundingSource: WebSearchSource = {
  id: 'google',
  async gather(query: string, context?: WebSearchContext): Promise<WebSearchSourceResult | null> {
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
            system: groundingSystem(context?.tasteBrief),
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
          logger.info(
            {
              attempt,
              keySlot: keyAttempt.slot,
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
