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

const CandidateSchema = z.object({
  title: z.string(),
  year: z.number().int().optional(),
  imdbId: z.string().optional(),
  tmdbId: z.string().optional(),
  mediaType: z.enum(['movie', 'series']),
})

export async function gatherWebCandidates(queryText: string): Promise<DiscoveryCandidate[]> {
  let model: LanguageModel
  try {
    model = await getWebSearchModelInstance()
  } catch {
    // Web Search role not configured — discovery is simply off
    return []
  }

  try {
    const tools = await getWebSearchProviderTools()

    // Pass 1 — grounded free-text suggestions
    const { text } = await generateText({
      model,
      tools,
      prompt:
        'Using current web information, list up to 12 specific movies or TV series that best answer this request. ' +
        'For each, give the exact title, release year, and whether it is a movie or a series. ' +
        'Include the IMDb id (tt…) or TMDb id ONLY if it appears in a source you actually used; otherwise omit it.\n\n' +
        `Request: ${queryText}`,
    })

    if (!text?.trim()) return []

    // Pass 2 — structure into typed candidates (no grounding needed)
    const { object } = await generateObject({
      model,
      schema: z.object({ candidates: z.array(CandidateSchema).max(20) }),
      prompt:
        'Extract the movies/series mentioned below into structured candidates. ' +
        'Set imdbId/tmdbId ONLY if explicitly present in the text — never guess or invent an id. ' +
        'Infer mediaType (movie or series) from context.\n\n' +
        text,
    })

    return object.candidates
  } catch (err) {
    logger.warn({ err }, 'Web candidate gathering failed; falling back to library behavior')
    return []
  }
}
