/**
 * Intent router for the chat pipeline.
 *
 * Classifies the latest user turn as 'discovery' (open-world / web-worthy) or
 * 'library' (anything about the user's own collection/history/stats — the
 * default). Fails open to 'library' so the original assistant role is never
 * regressed by a routing hiccup, and short-circuits obvious cases without an
 * LLM call.
 */
import { generateObject, type UIMessage } from 'ai'
import { z } from 'zod'
import { getChatModelInstance, createChildLogger } from '@aperture/core'

const logger = createChildLogger('route-intent')

export type ChatIntent = 'discovery' | 'library'

/** Obvious library signals — about the user's own collection/activity. */
const LIBRARY_HINTS =
  /\b(my|mine|i (?:have|own|watch|rated|like|love)|watch history|watched|how many|in my library|do i have|continue watching|resume)\b/i
/** Obvious discovery signals — open-world / external / current. */
const DISCOVERY_HINTS =
  /\b(best|top \d+|trending|acclaimed|popular|new releases?|latest|coming soon|this year|in \d{4}|oscar|award|critically)\b/i

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

  try {
    const model = await getChatModelInstance()
    const { object } = await generateObject({
      model,
      schema: z.object({ intent: z.enum(['discovery', 'library']) }),
      prompt:
        'Classify a request sent to a personal media-library assistant.\n' +
        "- 'discovery' = open-world / external / current: best-of lists, trending, acclaimed, award winners, new/upcoming releases, or things the user might be missing that are NOT necessarily in their library.\n" +
        "- 'library' = anything about the user's OWN collection, watch history, ratings, stats, or a personalized/conceptual recommendation drawn from what they already own.\n" +
        'When unsure, answer "library".\n\n' +
        `Request: ${text}`,
    })
    return object.intent
  } catch (err) {
    logger.warn({ err }, 'Intent classification failed; defaulting to library')
    return 'library'
  }
}
