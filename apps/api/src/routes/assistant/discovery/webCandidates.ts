/**
 * Gather web-sourced candidate titles for a discovery request.
 *
 * Runs in an ISOLATED call on the Web Search role model (grounding-capable,
 * Google). Pass 1 grounds free-text suggestions via google_search; pass 2
 * structures them into typed candidates. Kept entirely separate from the chat
 * stream, so grounding never mixes with the assistant's library tools (which
 * the Gemini API rejects). Fails to an empty list — the caller then behaves as
 * the normal library assistant, so discovery is purely additive.
 */
import { generateText, generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'
import {
  getWebSearchModelInstance,
  getWebSearchProviderTools,
  createChildLogger,
} from '@aperture/core'
import type { DiscoveryCandidate } from '../types.js'

const logger = createChildLogger('web-candidates')

// Shared candidate fields. `reason` is the per-title rationale rendered on each
// card AND used by the assistant to synthesize its reply — so we push hard for it
// to be present (required schema first). Gemini's structured-output pass tends to
// drop optional fields, which is exactly why the card notes came back empty.
const candidateFields = {
  title: z.string(),
  year: z.number().int().optional(),
  imdbId: z.string().optional(),
  tmdbId: z.string().optional(),
  mediaType: z.enum(['movie', 'series']),
}
const StrictCandidateSchema = z.object({ ...candidateFields, reason: z.string().min(1) })
const LenientCandidateSchema = z.object({ ...candidateFields, reason: z.string().optional() })

export async function gatherWebCandidates(queryText: string): Promise<DiscoveryCandidate[]> {
  let model: LanguageModel
  try {
    model = await getWebSearchModelInstance()
  } catch {
    // Web Search role not configured — discovery is simply off
    return []
  }

  logger.info({ query: queryText.slice(0, 200) }, 'Discovery routed: gathering web candidates')

  try {
    const tools = await getWebSearchProviderTools()

    // Pass 1 — grounded free-text suggestions
    const pass1 = await generateText({
      model,
      tools,
      prompt:
        'Using current web information, list up to 12 specific movies or TV series that best answer this request. ' +
        'For EACH title you MUST provide: the exact title, the release year, whether it is a movie or a series, and — most importantly — one or two sentences on WHY it fits this specific request. ' +
        'The "why" is mandatory for every title and should be concrete (tone, theme, what it shares with the request), not generic praise. A title with no reason is useless — omit it rather than list it without a reason. ' +
        'Include the IMDb id (tt…) or TMDb id ONLY if it appears in a source you actually used; otherwise omit it.\n\n' +
        `Request: ${queryText}`,
    })

    const { text } = pass1

    // Observability: prove grounding actually ran. Logs the search queries Google
    // issued and how many web sources came back — grep "web-candidates" to confirm
    // the Web Search role is doing real searches (vs. answering from training data).
    const grounding = (
      pass1.providerMetadata?.google as
        | { groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: unknown[] } }
        | undefined
    )?.groundingMetadata
    logger.info(
      {
        webSearchQueries: grounding?.webSearchQueries ?? [],
        groundingChunks: grounding?.groundingChunks?.length ?? 0,
        sources: pass1.sources?.length ?? 0,
        textChars: text?.length ?? 0,
      },
      'Web search grounding completed'
    )

    if (!text?.trim()) return []

    // Pass 2 — structure into typed candidates (no grounding needed). `reason`
    // is required first (Gemini drops optional fields, which emptied the cards);
    // if that trips validation we retry with a lenient schema so a stubborn
    // omission degrades to "card without a note" instead of killing discovery.
    const structurePrompt =
      'Extract the movies/series mentioned below into structured candidates. ' +
      'For each, capture the explanation of WHY it fits as "reason" (verbatim or lightly condensed from the text — one or two sentences, never empty). ' +
      'Set imdbId/tmdbId ONLY if explicitly present in the text — never guess or invent an id. ' +
      'Infer mediaType (movie or series) from context.\n\n' +
      text
    const structure = async (candidateSchema: z.ZodTypeAny) => {
      const { object } = await generateObject({
        model,
        schema: z.object({ candidates: z.array(candidateSchema).max(20) }),
        prompt: structurePrompt,
      })
      return object.candidates as DiscoveryCandidate[]
    }

    let candidates: DiscoveryCandidate[]
    try {
      candidates = await structure(StrictCandidateSchema)
    } catch (err) {
      logger.warn({ err }, 'Strict candidate structuring failed; retrying leniently (reasons may be missing)')
      candidates = await structure(LenientCandidateSchema)
    }

    const withReason = candidates.filter((c) => c.reason?.trim()).length
    logger.info(
      { candidateCount: candidates.length, withReason },
      'Web candidates structured'
    )
    return candidates
  } catch (err) {
    logger.warn({ err }, 'Web candidate gathering failed; falling back to library behavior')
    return []
  }
}
