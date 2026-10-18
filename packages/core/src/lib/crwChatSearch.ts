/**
 * fastCRW as a source for the assistant's web search.
 *
 * Title analysis uses fastCRW to read a few long documents carefully; the chat
 * needs something else — a quick look at what the web recommends for a
 * request, fed beside Google grounding and Tavily into one structuring pass
 * (api `assistant/discovery/sources/`). So this asks for less and waits less:
 *
 * - **One engine**, the first one not parked (`orderByHealth`), and no cascade.
 *   A blocked engine costs the turn nothing but this source's contribution;
 *   walking three engines would triple the worst case for a secondary source.
 *   The outcome is NOT recorded against engine health: an empty answer to a
 *   chat request says nothing about whether the engine is walling us.
 * - **At most {@link CHAT_CRW_MAX_PAGES} pages**, each given CRW's own default
 *   page budget, and the whole call cut at {@link CHAT_CRW_REQUEST_TIMEOUT_MS}.
 *   The sources run concurrently and the turn waits for the slowest, so this
 *   cap is what the chat can lose to fastCRW at most. CRW serializes searches
 *   on one browser tab, so a library analysis job running at the same time can
 *   push a chat search past the cap; it then contributes nothing.
 * - **The analysis filters, reused**: walled pages (`isBlockedPage`) and pages
 *   worth nothing (`dropLowValueSources`) are dropped, menus and furniture are
 *   stripped (`cleanSourceText`), and each page is trimmed to
 *   {@link CHAT_CRW_PAGE_CHARS}. Unlike analysis the quality filter does NOT
 *   fail open (`failOpen: false`): when every page is worthless the source
 *   contributes nothing, because the other sources are still there and a
 *   structuring pass fed menus does no good.
 *
 * Fails open in every direction: off, unconfigured, unreachable, timed out or
 * empty all return null, so a chat turn never fails over this source.
 */
import { isBlockedPage } from '../analysis/blockedPage.js'
import { cleanSourceText } from '../analysis/sourceCleanup.js'
import { dropLowValueSources, type LowValueReason } from '../analysis/sourceQuality.js'
import { crwSearch, getCrwConfig, isCrwEnabled, type CrwSearchResultItem } from './crw.js'
import { orderByHealth } from './crwEngines.js'
import { createChildLogger } from './logger.js'

const logger = createChildLogger('crw-chat-search')

/** Pages asked for; the operator's `maxResults` still caps it when lower. */
export const CHAT_CRW_MAX_PAGES = 5
/** Per-page budget inside the search: CRW's own default, sent explicitly. */
export const CHAT_CRW_PAGE_TIMEOUT_MS = 15_000
/** The whole call, search leg plus pages. What the chat can lose to this source. */
export const CHAT_CRW_REQUEST_TIMEOUT_MS = 25_000
/**
 * Characters kept from each page after cleaning. Enough for most of a "films
 * like X" list once menus are gone; five pages stay well inside what the
 * structuring pass reads alongside the other sources.
 */
export const CHAT_CRW_PAGE_CHARS = 2500

export interface ChatSearchPage {
  title: string
  url: string
  domain: string
  text: string
}

export interface ChatPagesOutcome {
  pages: ChatSearchPage[]
  dropped: Array<{ domain: string; reason: LowValueReason | 'walled' }>
}

/**
 * Cut a page to `max` characters at the last paragraph or sentence end that
 * keeps at least half of it, so a trimmed page ends on a finished thought;
 * failing that, a hard cut marked with an ellipsis.
 */
export function trimPageText(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const floor = Math.floor(max / 2)
  const paragraph = head.lastIndexOf('\n\n')
  if (paragraph >= floor) return head.slice(0, paragraph).trimEnd()
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'))
  if (sentence >= floor) return head.slice(0, sentence + 1)
  return `${head.trimEnd()}…`
}

/**
 * Turn raw search results into pages worth handing to the structuring pass.
 * Pure: drop walled and worthless pages, strip furniture, trim. Order is kept,
 * since it is the engine's relevance order.
 */
export function prepareChatPages(
  results: readonly CrwSearchResultItem[],
  maxChars = CHAT_CRW_PAGE_CHARS
): ChatPagesOutcome {
  const dropped: ChatPagesOutcome['dropped'] = []
  const readable = results
    .map((r) => ({ title: r.title, url: r.url, domain: r.domain, text: r.markdown ?? '' }))
    .filter((page) => {
      if (!isBlockedPage(page.text)) return true
      dropped.push({ domain: page.domain, reason: 'walled' })
      return false
    })

  // Not fail-open: beside other sources, a set of menus should add nothing.
  const quality = dropLowValueSources(readable, [], { failOpen: false })
  dropped.push(...quality.dropped)

  const pages = quality.kept
    .map((page) => ({ ...page, text: trimPageText(cleanSourceText(page.text).text, maxChars) }))
    .filter((page) => page.text.trim().length > 0)
  return { pages, dropped }
}

/**
 * Search fastCRW for a chat request. Null when the integration is off, left out
 * of the chat, unreachable, or found nothing worth keeping. Never throws.
 */
export async function searchCrwForChat(query: string): Promise<ChatSearchPage[] | null> {
  try {
    const config = await getCrwConfig()
    if (!isCrwEnabled(config) || !config.assistantSearch) return null

    const [engine] = orderByHealth(config.searchEngines)
    const response = await crwSearch(query, {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      maxResults: Math.min(config.maxResults, CHAT_CRW_MAX_PAGES),
      maxContentChars: config.maxContentChars,
      timeoutMs: CHAT_CRW_REQUEST_TIMEOUT_MS,
      pageTimeoutMs: CHAT_CRW_PAGE_TIMEOUT_MS,
      engine,
    })

    const { pages, dropped } = prepareChatPages(response.results)
    logger.info(
      {
        engine,
        results: response.results.length,
        kept: pages.length,
        dropped,
        warnings: response.warnings,
        chars: pages.reduce((sum, p) => sum + p.text.length, 0),
      },
      'fastCRW chat search completed'
    )
    return pages.length > 0 ? pages : null
  } catch (err) {
    // crwSearch has already written HTTP and network failures to api_errors.
    logger.warn({ err }, 'fastCRW chat search failed; continuing without it')
    return null
  }
}
