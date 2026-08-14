/**
 * Intent router for the chat pipeline.
 *
 * Classifies the latest user turn as 'discovery' (the answer is titles to go
 * watch) or 'library' (the answer is facts about the user's own collection).
 * Obvious cases short-circuit without an LLM call; everything else goes to the
 * chat model.
 *
 * THE AXIS IS WHAT KIND OF ANSWER IS WANTED, not whether the request mentions
 * the user. Getting that backwards is what routed "suggest film noir movies
 * based on my history" to 'library': a taxonomy that read any reference to the
 * user's collection as a library question, when a personalized recommendation
 * is still a recommendation. It cost the user both halves of what they asked
 * for, because the discovery path is *also* the personalized one —
 * `discovery/tasteBrief.ts` feeds their profile and recent watches into the
 * grounding call. "Based on my history" says how to aim the search, not what
 * kind of answer to give.
 *
 * Ambiguity now resolves toward 'discovery'. A discovery turn suppresses only
 * three list-building tools (DISCOVERY_SUPPRESSED_TOOLS in handlers/chat.ts)
 * and keeps history, ratings and stats, whereas a library turn has no web tool
 * at all — so discovery is very nearly the superset, and the cheaper mistake.
 * The error path still falls back to 'library': a routing *failure* is
 * different from a routing *doubt*, and DISCOVERY_PROMPT would otherwise order
 * a web search for a question that only wanted a count.
 */
import { generateText, type UIMessage } from 'ai'
import { getChatModelInstance, createChildLogger } from '@aperture/core'
import { recordLlmError } from './errors.js'

const logger = createChildLogger('route-intent')

export type ChatIntent = 'discovery' | 'library'

/**
 * Asking for something to watch. Checked FIRST and wins outright: alongside one
 * of these, a mention of the user's own collection is a qualifier ("based on my
 * history", "from my library"), never the subject of the question. A strict
 * priority subset of DISCOVERY_HINTS rather than a slice of it, so the broader
 * open-world list below stays readable on its own.
 */
const RECOMMENDATION_HINTS =
  /\b(recommend|suggest|what should i watch|what to watch|something to watch|anything good|find me|similar to|something like|(?:movie|film|show|series)s? like)\b/i
/**
 * Obvious library signals — about the user's own collection/activity.
 *
 * Deliberately excludes bare taste statements: "I like noir", "I love
 * westerns", "I watch a lot of horror" describe the person, not their library,
 * and matching them here hard-routed a recommendation request away from the web
 * search without ever consulting the classifier.
 */
const LIBRARY_HINTS =
  /\b(my|mine|i (?:have|own|rated)|watch history|watched|how many|in my library|do i have|continue watching|resume)\b/i
/**
 * Obvious discovery signals — open-world / external / current, seed-similarity,
 * or genre/style/theme exploration ("neo noir movies", "films about heists").
 */
const DISCOVERY_HINTS =
  /\b(best|top \d+|trending|acclaimed|popular|new releases?|latest|coming soon|this year|in \d{4}|oscar|award|critically|recommend|suggest|similar to|something like|(?:movies|films|shows) (?:like|of|about))\b/i

/**
 * The no-LLM decision, or null when the request needs the classifier.
 *
 * Pure and exported so the cases that have actually gone wrong in production
 * can be pinned without standing up a model — see routeIntent.test.ts.
 */
export function prefilterIntent(text: string): ChatIntent | null {
  if (RECOMMENDATION_HINTS.test(text)) return 'discovery'

  const library = LIBRARY_HINTS.test(text)
  const discovery = DISCOVERY_HINTS.test(text)
  if (library && !discovery) return 'library'
  if (discovery && !library) return 'discovery'
  return null
}

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
  const prefiltered = prefilterIntent(text)
  if (prefiltered) {
    // Which layer decided is the first thing you need when a turn routes wrong:
    // the prefilter is unappealable, the classifier is promptable. A log that
    // reports only the outcome sends you to the wrong one.
    logger.info({ intent: prefiltered, by: 'prefilter' }, 'Intent routed')
    return prefiltered
  }

  try {
    const model = await getChatModelInstance()
    // Plain text + lenient parsing rather than generateObject: the chat model is
    // user-selectable (incl. OpenRouter models that don't reliably emit JSON), and
    // a strict object parse throws NoObjectGeneratedError on a bare "discovery"/
    // "library" answer. A one-word classification doesn't need structured output.
    const { text: out } = await generateText({
      model,
      prompt:
        'Classify a request sent to a personal media assistant. It can search the web for things to watch, or answer questions about the user\'s own library.\n' +
        'Decide by WHAT KIND OF ANSWER the request wants — NOT by whether it mentions the user.\n' +
        '- \'discovery\' = the answer is titles to go watch: any recommendation, or exploration by genre, style, mood, theme, era, director or similarity (e.g. "neo noir movies", "feel-good comedies", "movies like Heat", "best sci-fi of 2025"). This INCLUDES personalized requests. "suggest film noir based on my history", "what should I watch given my taste" and "recommend something from my library" are all discovery: the recommendation is the answer, and the taste is only how to aim it.\n' +
        "- 'library' = the answer is facts about the user's own collection or activity: listing their watch history, their ratings, counts and stats, whether they own a particular title, or what to continue watching.\n" +
        'Test: if a good answer is a list of things to go and watch, it is discovery. If a good answer is information about what they already have or have already done, it is library.\n' +
        'Reply with exactly one word — discovery or library — and nothing else. When genuinely torn, answer discovery.\n\n' +
        `Request: ${text}`,
    })
    const intent = parseIntent(out)
    logger.info({ intent, by: 'model' }, 'Intent routed')
    return intent
  } catch (err) {
    // Surface the failure with its HTTP status instead of hiding it. The chat
    // model's provider varies (often unsupported by the errors framework), so
    // this logs only — no api_errors record — before failing open to library.
    await recordLlmError(err, { context: 'intent classification', logger })
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
