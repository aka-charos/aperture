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
 * degrades to a lenient schema, and if generateObject fails outright (a chat
 * model that can't emit structured output) we fall back to parsing a JSON array
 * out of a plain-text answer — so structuring never silently yields nothing.
 */
import { generateObject, generateText, type LanguageModel } from 'ai'
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
/**
 * Cap on candidates returned to the caller. Enforced by truncation AFTER
 * validation — never as a schema `.max()`. Combining several sources routinely
 * yields more titles than we want to show, and a schema cap turns that normal
 * outcome into a hard NoObjectGeneratedError that burns the whole retry ladder.
 */
const MAX_CANDIDATES = 20

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

/**
 * Reasons that only restate "this title appeared on a list" instead of
 * explaining the fit. Listicle sources ("25 movies like X") contribute bare
 * title lists, and a required `reason` field pressures the model into filling
 * them with this kind of non-explanation — which then renders as a meaningless
 * note on the card ("This film is listed as a movie like X").
 */
const FILLER_REASON_PATTERNS = [
  // Passive "this film is listed/mentioned as …" — the shape filler always takes.
  // Deliberately narrow: an active, substantive sentence that happens to use one
  // of these verbs ("Included as a companion piece because …") must NOT match.
  /\b(?:is|are|was|were)\s+(?:also\s+)?(?:listed|mentioned|included|named|referenced|recommended|suggested)\b/i,
  /\b(?:fans|viewers|users|you)\s+(?:\w+\s+){0,3}might\s+(?:also\s+)?enjoy\b/i,
]

/** A reason worth printing on a card: says something concrete, not list-filler. */
function isSubstantiveReason(reason: string | undefined): boolean {
  const text = (reason ?? '').trim()
  if (text.length < 30) return false
  return !FILLER_REASON_PATTERNS.some((re) => re.test(text))
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Post-process structured candidates: dedupe, drop meaningless reasons, order
 * well-explained picks first, then cap. Ordering matters — the cap should keep
 * the titles that can actually justify themselves on a card.
 */
function refineCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const seen = new Set<string>()
  const cleaned: DiscoveryCandidate[] = []

  for (const candidate of candidates) {
    const title = candidate.title?.trim()
    if (!title) continue
    const key = `${normalizeTitleKey(title)}|${candidate.mediaType}`
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push({
      ...candidate,
      title,
      // Better no note than a note that says nothing.
      reason: isSubstantiveReason(candidate.reason) ? candidate.reason?.trim() : undefined,
    })
  }

  const reasoned = cleaned.filter((c) => c.reason)
  const unreasoned = cleaned.filter((c) => !c.reason)
  return [...reasoned, ...unreasoned].slice(0, MAX_CANDIDATES)
}

/**
 * Tolerant fallback parse: pull the first JSON array out of a model's free-text
 * answer and coerce each entry into a candidate. Used only when generateObject
 * fails outright (a chat model that can't emit structured output).
 */
function parseCandidatesJson(text: string): DiscoveryCandidate[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []

  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const out: DiscoveryCandidate[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!title) continue
    out.push({
      title,
      year: typeof o.year === 'number' ? o.year : undefined,
      mediaType: o.mediaType === 'series' ? 'series' : 'movie',
      reason: typeof o.reason === 'string' ? o.reason : undefined,
    })
  }
  return out
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
    'CRITICAL: include a title ONLY if the text gives a real reason it fits — something concrete about tone, theme, director, plot or what it shares with the request. ' +
    'Some sources are bare "movies like X" lists with no explanation at all: OMIT those titles entirely. ' +
    'Never invent filler such as "this film is listed as similar", "it is mentioned as being similar" or "fans might enjoy it" — a title you cannot justify is worse than one you leave out. ' +
    'Deduplicate titles that appear in more than one source, merging their reasons. ' +
    'Never include the title the request is ASKING ABOUT as a candidate. ' +
    `Return at most ${MAX_CANDIDATES} candidates, best-justified first. ` +
    'Set imdbId/tmdbId ONLY if explicitly present in the text — never guess or invent an id. ' +
    'Infer mediaType (movie or series) from context. Ignore any text that is not a concrete movie/series recommendation.\n\n' +
    combined

  const structure = async (candidateSchema: z.ZodTypeAny) => {
    const { object } = await generateObject({
      model: structuring.model,
      maxRetries: SDK_MAX_RETRIES,
      // No `.max()` here on purpose — see MAX_CANDIDATES. Over-long results are
      // truncated after validation instead of failing it.
      schema: z.object({ candidates: z.array(candidateSchema) }),
      prompt: structurePrompt,
    })
    return object.candidates as DiscoveryCandidate[]
  }

  // Last-resort structuring for models that can't emit structured JSON at all:
  // ask for a JSON array as plain text and parse it tolerantly.
  const structureViaText = async (): Promise<DiscoveryCandidate[]> => {
    const { text } = await generateText({
      model: structuring.model,
      maxRetries: SDK_MAX_RETRIES,
      prompt:
        structurePrompt +
        '\n\nRespond with ONLY a JSON array (no prose, no code fences) of objects with keys ' +
        '"title" (string), "year" (number, optional), "mediaType" ("movie" or "series"), and ' +
        '"reason" (string). Example: [{"title":"…","year":1999,"mediaType":"movie","reason":"…"}]',
    })
    return parseCandidatesJson(text)
  }

  try {
    let candidates: DiscoveryCandidate[]
    try {
      candidates = await structure(StrictCandidateSchema)
    } catch (strictErr) {
      logger.warn(
        { err: strictErr },
        'Strict candidate structuring failed; retrying leniently (reasons may be missing)'
      )
      try {
        candidates = await structure(LenientCandidateSchema)
      } catch (lenientErr) {
        logger.warn(
          { err: lenientErr },
          'generateObject structuring failed; falling back to text extraction'
        )
        candidates = await structureViaText()
      }
    }

    const refined = refineCandidates(candidates)
    const withReason = refined.filter((c) => c.reason).length
    logger.info(
      {
        structured: candidates.length,
        candidateCount: refined.length,
        withReason,
        // structured > candidateCount means dupes/over-cap were trimmed;
        // withReason < candidateCount means list-filler reasons were stripped.
        droppedFillerReasons: refined.length - withReason,
      },
      'Web candidates structured'
    )
    return refined
  } catch (err) {
    // Structuring hard-failed (incl. the text fallback). Record under the
    // structuring model's provider when known (Gemini web-search role); otherwise
    // log-only (the provider varies).
    await recordLlmError(err, {
      context: 'discovery candidate structuring',
      provider: structuring.provider,
      logger,
    })
    return []
  }
}
