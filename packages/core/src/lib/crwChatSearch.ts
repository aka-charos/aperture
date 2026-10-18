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
 * - **Only SOME of the analysis filters.** Walled pages (`isBlockedPage`),
 *   empty fetches and the hand-read low-value domains are dropped, and images,
 *   empty and count links, solicitation lines, widget lines and furniture
 *   sections are stripped. The PROSE and MENU tests are deliberately NOT used:
 *   `hasNoProse` and `stripNavigationRuns` remove pages and runs made of
 *   link-only lines, which for criticism is a menu and for a recommendation is
 *   the answer — a "films like X" list of linked titles is that shape exactly.
 *   Links are flattened to their labels instead, so a list reads as titles and
 *   a site menu as a few short words the structuring pass ignores. Each page
 *   is then trimmed to {@link CHAT_CRW_PAGE_CHARS}. When nothing survives, the
 *   source contributes nothing rather than everything: the other sources are
 *   still there.
 *
 * Fails open in every direction: off, unconfigured, unreachable, timed out or
 * empty all return null, so a chat turn never fails over this source.
 */
import { isBlockedPage } from '../analysis/blockedPage.js'
import {
  stripCountLinks,
  stripEmptyLinks,
  stripFurnitureSections,
  stripImages,
  stripSolicitationLines,
  stripWidgetLines,
} from '../analysis/sourceCleanup.js'
import { LOW_VALUE_DOMAINS, MIN_USEFUL_CHARS } from '../analysis/sourceQuality.js'
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
 * like X" list even with a flattened site menu above it; five pages stay well
 * inside what the structuring pass reads alongside the other sources.
 */
export const CHAT_CRW_PAGE_CHARS = 3000

export interface ChatSearchPage {
  title: string
  url: string
  domain: string
  text: string
}

export interface ChatPagesOutcome {
  pages: ChatSearchPage[]
  dropped: Array<{ domain: string; reason: 'walled' | 'empty' | 'listed-domain' }>
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

/** `[label](url)` → `label`. Images are stripped before this runs. */
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g

/**
 * One page cleaned for the chat: markup and page furniture out, links reduced
 * to their labels, never the navigation-run or plot strips (see the header).
 */
export function cleanChatPageText(text: string): string {
  const markup = stripSolicitationLines(stripCountLinks(stripEmptyLinks(stripImages(text))))
  return stripWidgetLines(stripFurnitureSections(markup))
    .replace(MARKDOWN_LINK, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const isListedDomain = (domain: string): boolean => {
  const host = domain.trim().toLowerCase().replace(/^www\./, '')
  return LOW_VALUE_DOMAINS.some((entry) => host === entry.domain || host.endsWith(`.${entry.domain}`))
}

/**
 * Turn raw search results into pages worth handing to the structuring pass.
 * Pure: drop walled, empty and listed pages, clean, trim. Order is kept, since
 * it is the engine's relevance order.
 */
export function prepareChatPages(
  results: readonly CrwSearchResultItem[],
  maxChars = CHAT_CRW_PAGE_CHARS
): ChatPagesOutcome {
  const dropped: ChatPagesOutcome['dropped'] = []
  const pages: ChatSearchPage[] = []
  for (const r of results) {
    const raw = r.markdown ?? ''
    if (isBlockedPage(raw)) {
      dropped.push({ domain: r.domain, reason: 'walled' })
      continue
    }
    if (isListedDomain(r.domain)) {
      dropped.push({ domain: r.domain, reason: 'listed-domain' })
      continue
    }
    const text = cleanChatPageText(raw)
    // Measured after cleaning, so a page that was only images and links to
    // nothing counts as the empty fetch it effectively is.
    if (text.length < MIN_USEFUL_CHARS) {
      dropped.push({ domain: r.domain, reason: 'empty' })
      continue
    }
    pages.push({ title: r.title, url: r.url, domain: r.domain, text: trimPageText(text, maxChars) })
  }
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
      // A chat search timing out is usually a queue, not an outage; it is
      // logged below, not filed in the API errors panel.
      recordTimeouts: false,
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
