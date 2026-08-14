/**
 * Tavily web-search source.
 *
 * A pure web-search API (not an LLM): it returns result snippets plus an
 * optional synthesized answer. That material becomes grounding text that the
 * structuring pass turns into candidates — so Tavily works both as an extra
 * grounding source and as a fallback when Google grounding is empty/rate-limited.
 *
 * Optional: runs only when the integration is enabled with an API key. HTTP and
 * network failures are recorded to api_errors under the 'tavily' provider inside
 * the core client; here we just fail open to null.
 */
import {
  getTavilyConfig,
  isTavilyEnabled,
  tavilySearch,
  createChildLogger,
  type TavilySearchResponse,
} from '@aperture/core'
import type { WebSearchSource, WebSearchSourceResult } from './types.js'

const logger = createChildLogger('web-source-tavily')

/** Cap a snippet, adding an ellipsis when truncated, so long results don't bloat the prompt. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Tavily has ONE string for both retrieval and its answer LLM — there is no
 * separate answer prompt — so asking for reasoning means asking for it in the
 * query itself.
 *
 * Worth doing because the structuring pass omits any title that arrives without
 * a real "why" (see webCandidates.ts), and bare listicle snippets are exactly
 * what a plain query returns: Tavily can supply half the grounding text and
 * none of the candidates. The user's request stays the HEAD of the query so
 * retrieval still targets what they actually asked for; this is a trailing
 * clause, not a rewrite.
 */
const REASONING_CUE = ' For each title, explain why it fits.'

function searchQuery(request: string): string {
  const trimmed = request.trim()
  const punctuated = /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`
  return `${punctuated}${REASONING_CUE}`
}

/**
 * The synthesized answer gets a bigger budget than a snippet.
 *
 * `maxContentChars` is documented and presented as a per-RESULT snippet cap,
 * but it was applied to the answer too — so an admin lowering it to trim
 * snippet bloat was destroying the one piece of a Tavily response that carries
 * reasoning, and at the 100-char floor removing it outright. The answer is one
 * item rather than N, so it does not have the same bloat risk. It scales with
 * the snippet budget (so the setting still expresses intent) under an absolute
 * ceiling, so an 8000-char snippet setting cannot push 32k of prose into the
 * structuring prompt.
 */
const ANSWER_BUDGET_MULTIPLIER = 4
const ANSWER_CHAR_CEILING = 6000

function answerBudget(maxContentChars: number): number {
  return Math.min(maxContentChars * ANSWER_BUDGET_MULTIPLIER, ANSWER_CHAR_CEILING)
}

/**
 * Turn a Tavily response into grounded text: the synthesized answer first (most
 * useful for "movies like X"), then each result's title + snippet. Snippets are
 * truncated to `maxContentChars` (admin-configurable) to bound token cost; the
 * answer gets its own, larger budget — see answerBudget.
 */
function buildGroundedText(res: TavilySearchResponse, maxContentChars: number): string {
  const parts: string[] = []
  if (res.answer?.trim()) {
    parts.push(`Web answer: ${truncate(res.answer.trim(), answerBudget(maxContentChars))}`)
  }
  for (const r of res.results) {
    const title = r.title?.trim()
    const content = r.content?.trim()
    const line = [title, content ? truncate(content, maxContentChars) : '']
      .filter(Boolean)
      .join(' — ')
    if (line) parts.push(line)
  }
  return parts.join('\n')
}

export const tavilySource: WebSearchSource = {
  id: 'tavily',
  /**
   * Takes only the query, on purpose. `WebSearchContext.tasteBrief` is prose
   * written for a model prompt; Tavily is a search API, and appending a
   * paragraph about the viewer to a search string degrades the results rather
   * than personalising them. Personalisation happens on the grounding source,
   * which is an actual model call and can weigh a profile against a request.
   */
  async gather(query: string): Promise<WebSearchSourceResult | null> {
    try {
      const config = await getTavilyConfig()
      if (!isTavilyEnabled(config)) return null

      const res = await tavilySearch(searchQuery(query), {
        apiKey: config.apiKey,
        maxResults: config.maxResults,
        searchDepth: config.searchDepth,
        includeAnswer: config.includeAnswer,
        topic: config.topic,
        timeRange: config.timeRange,
      })

      const text = buildGroundedText(res, config.maxContentChars)
      logger.info(
        {
          results: res.results.length,
          hasAnswer: !!res.answer,
          // Separately from textChars, because the answer is the part that
          // carries reasoning and therefore the part that survives structuring.
          // A short answer here is the tell that Tavily is contributing tokens
          // without contributing candidates.
          answerChars: res.answer?.trim().length ?? 0,
          textChars: text.length,
        },
        'Tavily search completed'
      )
      if (!text.trim()) return null

      return {
        source: 'tavily',
        text,
        references: res.results.map((r) => ({ title: r.title, url: r.url, content: r.content })),
      }
    } catch (err) {
      // tavilySearch already recorded HTTP/network failures to api_errors ('tavily').
      logger.warn({ err }, 'Tavily search failed; continuing without it')
      return null
    }
  },
}
