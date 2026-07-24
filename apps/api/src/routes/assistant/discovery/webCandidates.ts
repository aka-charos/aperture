/**
 * Gather web-sourced candidate titles for a discovery request.
 *
 * Runs every enabled web-search SOURCE (Google grounding, Tavily, …) via the
 * source registry, combines their grounded text, and structures the combination
 * into typed candidates in a single pass. Sources compose (more grounding), fall
 * back for one another (Google 429 → Tavily), and let the model synthesize
 * across all of them. Fails to an empty list — the caller then behaves as the
 * normal library assistant, so discovery is purely additive.
 *
 * The structuring pass prefers the Web Search (Gemini) model — reliable JSON and
 * already configured for grounding — but a Tavily-only setup (no Gemini) falls
 * back to the text-generation, then chat model. `reason` is required first
 * (Gemini drops optional fields, which emptied the cards); a stubborn omission
 * degrades to a lenient schema so a missing note never kills discovery.
 */
import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'
import {
  getWebSearchModelInstance,
  getTextGenerationModelInstance,
  getChatModelInstance,
  createChildLogger,
} from '@aperture/core'
import { recordLlmError } from '../helpers/errors.js'
import { gatherFromSources } from './sources/index.js'
import type { DiscoveryCandidate } from '../types.js'

const logger = createChildLogger('web-candidates')

/** SDK-level retries (exp backoff) for 429/5xx on the structuring call. */
const SDK_MAX_RETRIES = 3

// Shared candidate fields. `reason` is the per-title rationale rendered on each
// card AND used by the assistant to synthesize its reply — so we push hard for
// it to be present (required schema first), then fall back to lenient.
const candidateFields = {
  title: z.string(),
  year: z.number().int().optional(),
  imdbId: z.string().optional(),
  tmdbId: z.string().optional(),
  mediaType: z.enum(['movie', 'series']),
}
const StrictCandidateSchema = z.object({ ...candidateFields, reason: z.string().min(1) })
const LenientCandidateSchema = z.object({ ...candidateFields, reason: z.string().optional() })

/** 'google' when the structuring model is the Gemini web-search role; else unknown. */
type StructuringProvider = 'google' | undefined

/**
 * Resolve the model for the structuring pass. When Google grounding contributed
 * material this turn it is clearly working, so we prefer it (reliable structured
 * output). Otherwise Google is unconfigured OR rate-limited — so we prefer the
 * text-generation → chat model rather than routing structuring through the same
 * failing quota. That ordering is what lets Tavily's results survive a Google
 * outage (the fallback case), not just a Google-unconfigured setup.
 */
async function getStructuringModel(
  preferGoogle: boolean
): Promise<{ model: LanguageModel; provider: StructuringProvider }> {
  const tryGoogle = async () => {
    try {
      return { model: await getWebSearchModelInstance(), provider: 'google' as const }
    } catch {
      return null
    }
  }
  const tryTextGen = async () => {
    try {
      return { model: await getTextGenerationModelInstance(), provider: undefined }
    } catch {
      return null
    }
  }
  const tryChat = async () => {
    try {
      return { model: await getChatModelInstance(), provider: undefined }
    } catch {
      return null
    }
  }

  const order = preferGoogle ? [tryGoogle, tryTextGen, tryChat] : [tryTextGen, tryChat, tryGoogle]
  for (const attempt of order) {
    const resolved = await attempt()
    if (resolved) return resolved
  }
  throw new Error('No model available to structure web candidates')
}

export async function gatherWebCandidates(queryText: string): Promise<DiscoveryCandidate[]> {
  logger.info({ query: queryText.slice(0, 200) }, 'Discovery routed: gathering web candidates')

  const results = await gatherFromSources(queryText)
  if (results.length === 0) {
    // No source enabled, or all failed/returned empty. Discovery is off/degraded;
    // the caller falls back to library behavior.
    return []
  }

  // Combine grounded material from every source, labeled so the model can weigh
  // them. When multiple sources fire, this is what "synthesize from both" means.
  const combined = results.map((r) => `## Web findings (${r.source})\n${r.text}`).join('\n\n')
  logger.info(
    { sources: results.map((r) => r.source), combinedChars: combined.length },
    'Discovery: combined web source material'
  )

  const googleContributed = results.some((r) => r.source === 'google')
  let structuring: { model: LanguageModel; provider: StructuringProvider }
  try {
    structuring = await getStructuringModel(googleContributed)
  } catch (err) {
    await recordLlmError(err, { context: 'discovery structuring model', logger })
    return []
  }

  // Structure the combined material into typed candidates (no grounding needed).
  const structurePrompt =
    'The text below is web research about a movie/TV recommendation request, possibly from multiple sources. ' +
    'Extract the specific movies/series it recommends into structured candidates. ' +
    'For each, capture the explanation of WHY it fits as "reason" (verbatim or lightly condensed — one or two sentences, never empty). ' +
    'Deduplicate titles that appear in more than one source, merging their reasons. ' +
    'Set imdbId/tmdbId ONLY if explicitly present in the text — never guess or invent an id. ' +
    'Infer mediaType (movie or series) from context. Ignore any text that is not a concrete movie/series recommendation.\n\n' +
    combined

  const structure = async (candidateSchema: z.ZodTypeAny) => {
    const { object } = await generateObject({
      model: structuring.model,
      maxRetries: SDK_MAX_RETRIES,
      schema: z.object({ candidates: z.array(candidateSchema).max(20) }),
      prompt: structurePrompt,
    })
    return object.candidates as DiscoveryCandidate[]
  }

  try {
    let candidates: DiscoveryCandidate[]
    try {
      candidates = await structure(StrictCandidateSchema)
    } catch (err) {
      logger.warn({ err }, 'Strict candidate structuring failed; retrying leniently (reasons may be missing)')
      candidates = await structure(LenientCandidateSchema)
    }

    const withReason = candidates.filter((c) => c.reason?.trim()).length
    logger.info({ candidateCount: candidates.length, withReason }, 'Web candidates structured')
    return candidates
  } catch (err) {
    // Structuring hard-failed. Record under the structuring model's provider when
    // known (Gemini web-search role); otherwise log-only (the provider varies).
    await recordLlmError(err, {
      context: 'discovery candidate structuring',
      provider: structuring.provider,
      logger,
    })
    return []
  }
}
