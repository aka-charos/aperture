/**
 * Intent router for the chat pipeline.
 *
 * Classifies the latest user turn as 'discovery' (open-world / web-worthy) or
 * 'library' (anything about the user's own collection/history/stats — the
 * default). Fails open to 'library' so the original assistant role is never
 * regressed by a routing hiccup, and short-circuits obvious cases without an
 * LLM call.
 */
import { generateText, type UIMessage } from 'ai'
import { getChatModelInstance, createChildLogger } from '@aperture/core'

const logger = createChildLogger('route-intent')

export type ChatIntent = 'discovery' | 'library'

/** Obvious library signals — about the user's own collection/activity. */
const LIBRARY_HINTS =
  /\b(my|mine|i (?:have|own|watch|rated|like|love)|watch history|watched|how many|in my library|do i have|continue watching|resume)\b/i
/** Obvious discovery signals — open-world / external / current, or seed-similarity. */
const DISCOVERY_HINTS =
  /\b(best|top \d+|trending|acclaimed|popular|new releases?|latest|coming soon|this year|in \d{4}|oscar|award|critically|similar to|something like|(?:movies|films|shows) like)\b/i

/** Extract the most recent user message as plain text. */
export function latestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const text = (m.parts ?? [])
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join(' ')
      .trim()
    if (text) return text
  }
  return ''
}

export async function classifyIntent(messages: UIMessage[]): Promise<ChatIntent> {
  const text = latestUserText(messages)
  if (!text) return 'library'

  // Heuristic prefilter — skip the LLM on clear cases
  if (LIBRARY_HINTS.test(text) && !DISCOVERY_HINTS.test(text)) return 'library'
  if (DISCOVERY_HINTS.test(text) && !LIBRARY_HINTS.test(text)) return 'discovery'

  try {
    const model = await getChatModelInstance()
    // Plain text + lenient parsing rather than generateObject: the chat model is
    // user-selectable (incl. OpenRouter models that don't reliably emit JSON), and
    // a strict object parse throws NoObjectGeneratedError on a bare "discovery"/
    // "library" answer. A one-word classification doesn't need structured output.
    const { text: out } = await generateText({
      model,
      prompt:
        'Classify a request sent to a personal media-library assistant.\n' +
        "- 'discovery' = open-world / external / current: best-of lists, trending, acclaimed, award winners, new/upcoming releases, or things the user might be missing that are NOT necessarily in their library.\n" +
        "- 'library' = anything about the user's OWN collection, watch history, ratings, stats, or a personalized/conceptual recommendation drawn from what they already own.\n" +
        'Reply with exactly one word — discovery or library — and nothing else. When unsure, reply library.\n\n' +
        `Request: ${text}`,
    })
    return parseIntent(out)
  } catch (err) {
    logger.warn({ err }, 'Intent classification failed; defaulting to library')
    return 'library'
  }
}

/**
 * Map a free-text model answer to an intent. Accepts a clean one-word reply
 * ("discovery", "library", with any surrounding punctuation/quotes) and degrades
 * gracefully on a verbose answer — biased to the safe 'library' default unless
 * only 'discovery' is mentioned.
 */
export function parseIntent(out: string): ChatIntent {
  const answer = (out ?? '').toLowerCase()
  const compact = answer.replace(/[^a-z]/g, '')
  if (compact === 'discovery') return 'discovery'
  if (compact === 'library') return 'library'

  const hasDiscovery = /\bdiscovery\b/.test(answer)
  const hasLibrary = /\blibrary\b/.test(answer)
  return hasDiscovery && !hasLibrary ? 'discovery' : 'library'
}
