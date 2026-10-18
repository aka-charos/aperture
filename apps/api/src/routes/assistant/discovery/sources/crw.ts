/**
 * fastCRW web-search source.
 *
 * The self-hosted search-and-scrape service that title analysis retrieves
 * through, asked here as a third source beside Google grounding and Tavily.
 * Like Tavily it is not an LLM: it returns pages, and the structuring pass
 * turns them into candidates — a "films like X" list page is exactly what it
 * is good at finding.
 *
 * Every limit and filter lives in core `searchCrwForChat` (one engine, at most
 * five pages, a 25-second cap, walled and worthless pages dropped, furniture
 * stripped, each page trimmed); this file only shapes the text. Runs whenever
 * the integration is enabled, unless its card's "Use in the assistant's web
 * search" switch is off. Fails open to null.
 */
import { searchCrwForChat } from '@aperture/core'
import type { WebSearchSource, WebSearchSourceResult } from './types.js'

export const crwSource: WebSearchSource = {
  id: 'fastcrw',
  async gather(query: string): Promise<WebSearchSourceResult | null> {
    const pages = await searchCrwForChat(query)
    if (!pages?.length) return null

    // Title and domain head each page so the structuring model can tell one
    // article from the next, as Tavily's `title — snippet` lines do.
    const text = pages.map((p) => `### ${p.title || p.domain} (${p.domain})\n${p.text}`).join('\n\n')
    return {
      source: 'fastcrw',
      text,
      references: pages.map((p) => ({ title: p.title, url: p.url, content: p.text })),
    }
  },
}
