/**
 * Tavily web-search source.
 *
 * A pure web-search API (not an LLM): it returns result snippets plus an
 * optional synthesized answer. That material becomes grounding text that the
 * structuring pass turns into candidates — so Tavily works both as an extra
 * grounding source and as a fallback when Google grounding is empty/rate-limited.
 *
 * Optional: runs only when the integration is enabled with an API key. HTTP
 * failures are recorded to api_errors under the 'tavily' provider inside the
 * core client; here we just fail open to null.
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

/**
 * Turn a Tavily response into grounded text: the synthesized answer first (most
 * useful for "movies like X"), then each result's title + snippet.
 */
function buildGroundedText(res: TavilySearchResponse): string {
  const parts: string[] = []
  if (res.answer?.trim()) parts.push(`Web answer: ${res.answer.trim()}`)
  for (const r of res.results) {
    const line = [r.title?.trim(), r.content?.trim()].filter(Boolean).join(' — ')
    if (line) parts.push(line)
  }
  return parts.join('\n')
}

export const tavilySource: WebSearchSource = {
  id: 'tavily',
  async gather(query: string): Promise<WebSearchSourceResult | null> {
    try {
      const config = await getTavilyConfig()
      if (!isTavilyEnabled(config)) return null

      const res = await tavilySearch(query, {
        apiKey: config.apiKey,
        maxResults: config.maxResults,
        searchDepth: config.searchDepth,
        includeAnswer: config.includeAnswer,
        includeImages: config.includeImages,
        topic: config.topic,
        timeRange: config.timeRange,
      })

      const text = buildGroundedText(res)
      logger.info(
        { results: res.results.length, hasAnswer: !!res.answer, textChars: text.length },
        'Tavily search completed'
      )
      if (!text.trim()) return null

      return {
        source: 'tavily',
        text,
        references: res.results.map((r) => ({ title: r.title, url: r.url, content: r.content })),
      }
    } catch (err) {
      // tavilySearch already recorded HTTP failures to api_errors ('tavily').
      logger.warn({ err }, 'Tavily search failed; continuing without it')
      return null
    }
  },
}
