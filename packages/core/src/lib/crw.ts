/**
 * fastCRW integration — self-hosted web retrieval.
 *
 * CRW fronts a SearXNG sidecar and a scraper behind one API: `/v1/search` with
 * `scrapeOptions` runs a metasearch AND fetches each result, returning cleaned
 * markdown in a single call. That combination is the whole reason this exists —
 * it is the same shape as a grounded LLM call, with no per-day cap.
 *
 * WHY THIS REPLACED GOOGLE GROUNDING FOR TITLE ANALYSIS. Gemini's grounded
 * search is capped per day per Google project, and on a free tier the binding
 * limit turned out to be the MODEL's request cap, not the grounding one —
 * measured at 20 requests/day against a 1,500/day grounding allowance. A pass
 * over a 13,000-title library was therefore two years of work per key. Retrieval
 * here is bounded by the operator's own hardware instead.
 *
 * IT ALSO IMPROVES THE OUTPUT, which matters more. Grounding handed the model
 * search snippets and trusted it to reason; a fetched page gives the model the
 * actual article, so "work only from the sources below" becomes an enforceable
 * instruction rather than a hope. See ../analysis/prompt.ts.
 *
 * A NOTE ON THE PARSING BELOW. This is written against a described API on a
 * young project (0.10.0, three contributors), so the response reader accepts
 * several plausible field names rather than one. A shape difference should cost
 * a field, not the feature — and when nothing parses at all, that is logged
 * once with the keys actually present, because "analysis finds no sources for
 * anything" is otherwise indistinguishable from "the web has nothing".
 *
 * Config is a single JSON blob in `system_settings` (mirrors ./tavily.ts and the
 * n8n integration). HTTP and network failures are recorded to `api_errors` under
 * the 'crw' provider so an unreachable container surfaces in the admin panel
 * rather than only in a job log.
 */
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { createChildLogger } from './logger.js'
import { parseApiError, logApiError, hasRecentSimilarError } from '../errors/index.js'
import {
  DEFAULT_CURATED_SITES,
  sanitizeCuratedSites,
} from '../analysis/curatedSearch.js'

const logger = createChildLogger('crw')

/**
 * Web search engines CRW can drive, in the spelling its API expects.
 *
 * Only the general-web ones. CRW also knows `github`, `wikipedia`, `youtube`,
 * `reddit` and `amazon`, but those are site-scoped and would answer a request
 * for film criticism with whatever that one site happens to hold.
 */
export const CRW_SEARCH_ENGINES = ['google', 'duckduckgo', 'bing'] as const

export type CrwSearchEngine = (typeof CRW_SEARCH_ENGINES)[number]

export interface CrwConfig {
  /** Master switch; retrieval runs only when this is true and a base URL is set. */
  enabled: boolean
  /**
   * Service root, no path — e.g. `http://host.docker.internal:3000`.
   *
   * ADDRESSING IS THE COMMONEST WAY TO GET THIS WRONG. fastCRW ships its own
   * compose project (server + SearXNG + LightPanda), so it normally sits on a
   * DIFFERENT Docker network to Aperture and its service name will not resolve
   * from here. Use the port it publishes on the host —
   * `http://host.docker.internal:3000` on Docker Desktop, or the host's LAN IP
   * elsewhere. `http://crw:3000` only works if the two stacks share a network.
   * `localhost` never works: inside a container that is Aperture itself.
   */
  baseUrl: string
  /** Optional. Self-hosted deployments frequently run without one. */
  apiKey: string
  /** How many search results to fetch and scrape (1–20). */
  maxResults: number
  /**
   * How many EXTRA documents the curated criticism search may add (0–20).
   *
   * ADDITIVE, NEVER A SHARE OF `maxResults`. The general search keeps every
   * one of its results; this is a second search whose hits are appended. So a
   * title with criticism written about it reaches the prompt with
   * `maxResults + curatedMaxResults` documents, and one without it reaches the
   * prompt with exactly `maxResults` - unchanged from before this existed.
   *
   * It has its own number rather than a slice of `maxResults` because those
   * are two different questions. Taking criticism out of `maxResults` made
   * that setting mean "documents in total, of which an unpredictable share are
   * general", so an operator could no longer reason about either number.
   *
   * 0 turns the second search off entirely - no query, no scrape, no cost.
   *
   * What bounds the PROMPT is `sourceBudgetChars`, not this: more documents
   * divide the same character budget more ways rather than growing it.
   */
  curatedMaxResults: number
  /**
   * The publications the curated search asks, as bare `site:` values.
   *
   * Editable because which publications count as criticism is a judgement
   * about taste and language coverage: twenty English-language journals serve
   * a Greek or Korean library badly, and nobody but the operator knows that.
   * Empty means the shipped default, NOT "search nowhere" - an empty list with
   * `curatedMaxResults` still set would issue a query with an empty
   * disjunction, which matches nothing; switching the search off is what
   * `curatedMaxResults: 0` is for.
   */
  curatedSites: string[]
  /**
   * Hard per-result cap on returned markdown (1,000–100,000).
   *
   * This is a SAFETY VALVE, not the token budget. A single pathological page
   * should not be able to blow up JSON parsing or memory; deciding how much
   * text the model actually sees is the analysis module's job, because only it
   * knows the target model's context window.
   */
  maxContentChars: number
  /**
   * Whole-request timeout (5,000–300,000 ms): how long Aperture waits for one
   * search call, which searches and then fetches every result.
   *
   * WHAT BOUNDS A SEARCH CALL IS `pageTimeoutMs`, NOT THE RENDER LADDER. This
   * used to be sized against `ladder_min_ms` from CRW's boot log (82.5s on a
   * stock deployment, 126.5s with Byparr), on the belief that one page reaching
   * the heavy tier could take that long. That number is the budget for ONE
   * `/v1/scrape`. Inside `/v1/search` every result gets its own deadline -
   * `scrapeOptions.timeout`, or 15s when the request names none - so a call is
   * bounded by its search leg plus one page budget. Read in crw-camofox 1.5.0's
   * `routes/search.rs` (`SEARCH_ENRICH_DEADLINE_MS`), and confirmed in a live
   * log where a page's budget ran out exactly 15s after it started.
   *
   * It must still clear `pageTimeoutMs` plus {@link SEARCH_LEG_ALLOWANCE_MS},
   * or Aperture abandons a call CRW was about to answer; a timeout here throws,
   * which writes no row, so the title stays pending and the work is lost. The
   * route refuses a pair that does not, and {@link effectivePageTimeoutMs}
   * shrinks the page budget for a stored pair saved before that check existed.
   */
  timeoutMs: number
  /**
   * How long CRW may spend fetching ONE result page inside a search (5,000–
   * 60,000 ms), sent as `scrapeOptions.timeout`.
   *
   * WITHOUT IT CRW GIVES EVERY PAGE 15 SECONDS, and that is where pages behind
   * a bot wall were being lost. The ladder is HTTP, impersonated HTTP,
   * LightPanda, Camofox (which waits up to 20s for a Cloudflare challenge to
   * clear), then Byparr - and inside 15s the last two get what the first ones
   * left. Measured on one deployment: Camofox abandoned its challenge wait
   * after 5-6s on two pages, Byparr hit the 15s wall all three times it was
   * tried, and a direct `/v1/scrape` of one of those pages - which gets the
   * whole ladder - came back through Byparr in 12.1s. A second page from a host
   * already being fetched waits its turn INSIDE its own budget (CRW limits
   * requests per site), and lost the whole 15s to the wait.
   *
   * The cost lands only where a page is slow: a search waits for its slowest
   * result, so a title with a walled page takes up to this long per search
   * instead of 15s. 60s is CRW's own ceiling - it answers 400 above that.
   */
  pageTimeoutMs: number
  /**
   * Total characters of retrieved text handed to the model in one prompt
   * (2,000–200,000). THIS is the real budget; `maxContentChars` above is only a
   * per-page safety valve.
   *
   * It is bounded by the MODEL's context window, not by anything CRW does —
   * which makes this the one field on this card that is really about the AI
   * role. It lives here anyway because an operator tunes retrieval volume and
   * how much of it the model can swallow as a single decision, and splitting
   * one number into its own settings blob would make that harder to get right
   * rather than easier.
   *
   * Default 16,000 (~4k tokens) is deliberately conservative: it leaves room for
   * the prompt and a long answer inside an 8k-context local model, which is the
   * smallest thing anyone is likely to point at this. Raise it to match a bigger
   * window — more source text is strictly better for this task, right up until
   * it stops fitting.
   */
  sourceBudgetChars: number
  /**
   * Ceiling on the model's own answer, in tokens. 0 means no ceiling.
   *
   * VISIBLE BECAUSE THE HIDDEN VERSION COST A LIBRARY PASS. This was a
   * hardcoded 2,000 in the analysis module, and 2,000 sits near the length of a
   * legitimate long answer (~900 words is ~1,200 tokens) rather than far above
   * it. A reasoning model bills its scratchpad from the same allowance, so the
   * first real run spent the whole budget thinking, was cut off before writing
   * any analysis, and stored the scratchpad. The only way to discover the
   * number existed was to hit that bug and go looking.
   *
   * IT IS A RUNAWAY BACKSTOP, NOT A LENGTH CONTROL, and the distinction is the
   * whole point. Asking the prompt for a length is an editorial instruction: the
   * model complies and still produces a finished piece of writing. A token cap
   * is a guillotine that produces a BROKEN one. So this belongs far above any
   * answer you would want, and the prompt is where length is actually shaped.
   * Truncation is no longer silent either — it throws and leaves the title
   * pending — which is what makes a default cap safe rather than destructive.
   *
   * Lives on this card, next to sourceBudgetChars, for the reason that one is
   * here: how much text goes in and how much may come out are the same decision
   * about the same model's context window, and splitting them across two
   * screens would mean tuning one without seeing the other.
   */
  analysisMaxOutputTokens: number
  /**
   * Engines to try, in order, until one answers. Never empty.
   *
   * WHY A CASCADE AND NOT A CHOICE. Google is the best of these when it works
   * and refuses outright when it does not: a blocked client is redirected to
   * `/sorry/index` and CRW reports `200 {results: []}` with a warning, which is
   * shaped exactly like "the web has nothing on this title". Measured live on a
   * datacenter address, every query walled while DuckDuckGo answered the same
   * query fine. One engine is therefore a single point of failure that fails
   * silently, and which engine is available is a property of the deployment -
   * its IP, its browser profile, its country - so no default can be right for
   * everyone and it has to be an operator setting.
   *
   * ORDER IS PREFERENCE, NOT PARALLELISM. Each entry is a separate request, so
   * a first engine that is permanently walled costs one wasted round trip per
   * title (~1.4s measured) forever. That is negligible against a title that
   * takes 45s-3min, and it self-heals the day the block lifts - but if yours is
   * walled for good, take it off the list rather than paying for it 13,000
   * times. Do NOT pass several engines in one CRW request instead: CRW runs
   * them sequentially on one warm tab and returns the union, so that is N times
   * the latency on EVERY title including the healthy ones, which is the exact
   * opposite of a fallback.
   */
  searchEngines: CrwSearchEngine[]
}

export const DEFAULT_CRW_CONFIG: CrwConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  maxResults: 6,
  // Four: enough that a well-covered film arrives with several real essays,
  // small enough that the extra scraping is four pages and not another six.
  curatedMaxResults: 4,
  curatedSites: [...DEFAULT_CURATED_SITES],
  maxContentChars: 12000,
  timeoutMs: 180000,
  // Three times CRW's own 15s, which leaves Camofox its full 20s challenge wait
  // and Byparr time after it, while keeping a search with one wedged page under
  // a minute. Not CRW's 60s ceiling: that is held back for an operator who
  // finds a source that needs it.
  pageTimeoutMs: 45000,
  sourceBudgetChars: 16000,
  // Generous rather than tight: ~1,200 tokens covers the longest answer the
  // prompt asks for, so this leaves roughly 6,800 for a reasoning model's
  // scratchpad. Not higher by default because output shares one context window
  // with a prompt that is already ~16,000 characters of article text, and a
  // 32k-context local model has to fit both.
  analysisMaxOutputTokens: 8000,
  // Google first because its results are the best of the three when it is not
  // walling the client, and the fallbacks cost nothing on a run where it works.
  searchEngines: ['google', 'duckduckgo', 'bing'],
}

const SETTING_KEY = 'crw_integration'

const clampInt = (n: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

const clampMaxResults = (n: number) => clampInt(n, 1, 20, DEFAULT_CRW_CONFIG.maxResults)
const clampCuratedResults = (n: number) =>
  clampInt(n, 0, 20, DEFAULT_CRW_CONFIG.curatedMaxResults)
/**
 * A stored list, cleaned - or the shipped default when there is nothing usable.
 *
 * The fallback is what stops a list that sanitizes to empty (every entry a
 * bare word, say) from building a query with an empty disjunction, which
 * matches nothing and reports it as "no criticism written about this title".
 */
const resolveCuratedSites = (value: unknown): string[] => {
  const cleaned = sanitizeCuratedSites(value)
  return cleaned.length > 0 ? cleaned : [...DEFAULT_CURATED_SITES]
}
const clampContentChars = (n: number) =>
  clampInt(n, 1000, 100_000, DEFAULT_CRW_CONFIG.maxContentChars)
const clampTimeout = (n: number) => clampInt(n, 5000, 300_000, DEFAULT_CRW_CONFIG.timeoutMs)

/** The per-page budget CRW applies inside a search when the request names none. */
export const CRW_DEFAULT_PAGE_TIMEOUT_MS = 15_000
/** Bounds on `pageTimeoutMs`. The ceiling is CRW's: it refuses a larger value with a 400. */
export const CRW_PAGE_TIMEOUT_MIN_MS = 5_000
export const CRW_PAGE_TIMEOUT_MAX_MS = 60_000

/**
 * What a search call needs on top of its page budget: the search itself.
 *
 * CRW drives every engine through ONE browser tab and serializes searches on
 * it, so a call waits for the searches queued ahead of it before its own runs.
 * Retrieval runs the general search and up to `CURATED_MAX_QUERIES` (4)
 * criticism queries at once, and each search round trip is capped at CRW's
 * `search.timeout_ms` (15s). A normal search takes a few seconds; this covers
 * a few slow ones queued ahead, not the theoretical five-deep worst case, which
 * would need every search to hit CRW's own timeout in a row.
 */
export const SEARCH_LEG_ALLOWANCE_MS = 60_000

const clampPageTimeout = (n: number) =>
  clampInt(n, CRW_PAGE_TIMEOUT_MIN_MS, CRW_PAGE_TIMEOUT_MAX_MS, DEFAULT_CRW_CONFIG.pageTimeoutMs)

/** The smallest whole-request timeout that leaves a page budget its full length. */
export function minimumRequestTimeoutMs(pageTimeoutMs: number): number {
  return clampPageTimeout(pageTimeoutMs) + SEARCH_LEG_ALLOWANCE_MS
}

/**
 * The page budget actually sent: the configured one, shrunk to fit inside the
 * whole-request timeout, and never below what CRW would use anyway.
 *
 * Shrunk rather than sent as configured because a page budget Aperture cannot
 * wait for is worse than a shorter one - the call is abandoned and every page
 * it fetched is lost with it. That happens only to a pair stored before the
 * route checked it (the route now refuses one); a config written since always
 * gets its configured value.
 *
 * The SHRINK stops at CRW's own 15s, because that is what a request with no
 * timeout gets: an existing deployment with a short request timeout therefore
 * behaves exactly as it did before this setting existed, never worse. A budget
 * CONFIGURED below 15s is sent as configured - that is an operator choosing
 * faster searches over slow pages, and the floor is not there to overrule them.
 */
export function effectivePageTimeoutMs(pageTimeoutMs: number, requestTimeoutMs: number): number {
  const configured = clampPageTimeout(pageTimeoutMs)
  const room = Math.max(
    CRW_DEFAULT_PAGE_TIMEOUT_MS,
    clampTimeout(requestTimeoutMs) - SEARCH_LEG_ALLOWANCE_MS
  )
  return Math.min(configured, room)
}

const clampSourceBudget = (n: number) =>
  clampInt(n, 2000, 200_000, DEFAULT_CRW_CONFIG.sourceBudgetChars)
/**
 * Keep only engines CRW knows, in the order given, without repeats.
 *
 * Falls back to the default list rather than to an empty one: an empty list
 * would make CRW apply its own default (Google alone), which is the setup this
 * field exists to escape - so a typo would silently reinstate the fault.
 */
export function sanitizeSearchEngines(raw: unknown): CrwSearchEngine[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CRW_CONFIG.searchEngines]
  const seen = new Set<string>()
  const out: CrwSearchEngine[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const name = entry.trim().toLowerCase()
    if (!isCrwSearchEngine(name) || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out.length > 0 ? out : [...DEFAULT_CRW_CONFIG.searchEngines]
}

/** Narrowing guard, so the route and the sanitizer share one list. */
export function isCrwSearchEngine(value: string): value is CrwSearchEngine {
  return (CRW_SEARCH_ENGINES as readonly string[]).includes(value)
}

/** 0 is meaningful — "send no ceiling at all" — so it bypasses the range. */
export const clampAnalysisOutputTokens = (n: number): number => {
  if (n === 0) return 0
  return clampInt(n, 512, 128_000, DEFAULT_CRW_CONFIG.analysisMaxOutputTokens)
}

function sanitize(config: Partial<CrwConfig>): CrwConfig {
  return {
    ...DEFAULT_CRW_CONFIG,
    ...config,
    // Trailing slashes are stripped here rather than at every call site: the
    // request path is appended directly, and `http://crw:3000/` + `/v1/search`
    // is a 404 that reads as "the service is broken".
    baseUrl: (config.baseUrl ?? '').trim().replace(/\/+$/, ''),
    apiKey: (config.apiKey ?? '').trim(),
    maxResults: clampMaxResults(config.maxResults ?? DEFAULT_CRW_CONFIG.maxResults),
    curatedMaxResults: clampCuratedResults(
      config.curatedMaxResults ?? DEFAULT_CRW_CONFIG.curatedMaxResults
    ),
    curatedSites: resolveCuratedSites(config.curatedSites),
    maxContentChars: clampContentChars(
      config.maxContentChars ?? DEFAULT_CRW_CONFIG.maxContentChars
    ),
    timeoutMs: clampTimeout(config.timeoutMs ?? DEFAULT_CRW_CONFIG.timeoutMs),
    pageTimeoutMs: clampPageTimeout(config.pageTimeoutMs ?? DEFAULT_CRW_CONFIG.pageTimeoutMs),
    sourceBudgetChars: clampSourceBudget(
      config.sourceBudgetChars ?? DEFAULT_CRW_CONFIG.sourceBudgetChars
    ),
    analysisMaxOutputTokens: clampAnalysisOutputTokens(
      config.analysisMaxOutputTokens ?? DEFAULT_CRW_CONFIG.analysisMaxOutputTokens
    ),
    searchEngines: sanitizeSearchEngines(config.searchEngines),
  }
}

export async function getCrwConfig(): Promise<CrwConfig> {
  const json = await getSystemSetting(SETTING_KEY)
  if (json) {
    try {
      // Merged over defaults so a blob written before a new field existed still
      // returns a complete, well-typed config.
      return sanitize(JSON.parse(json) as Partial<CrwConfig>)
    } catch (e) {
      logger.error({ error: e }, 'Failed to parse crw_integration config')
    }
  }
  return { ...DEFAULT_CRW_CONFIG }
}

export async function setCrwConfig(config: CrwConfig): Promise<void> {
  await setSystemSetting(
    SETTING_KEY,
    JSON.stringify(sanitize(config)),
    'Self-hosted fastCRW retrieval service (search + scrape) for title analysis'
  )
  logger.info('fastCRW integration configuration updated')
}

/** True when retrieval should run. An API key is optional; a base URL is not. */
export function isCrwEnabled(config: CrwConfig): boolean {
  return config.enabled && !!config.baseUrl.trim()
}

export class CrwError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'CrwError'
    this.status = status
  }
}

export interface CrwSearchResultItem {
  title: string
  url: string
  /** Hostname with a leading `www.` stripped — the durable provenance signal. */
  domain: string
  /** Cleaned page text. Empty when the scrape failed for this result alone. */
  markdown: string
}

export interface CrwSearchResponse {
  query: string
  results: CrwSearchResultItem[]
  /**
   * Soft failures the service reported alongside a 200.
   *
   * THIS IS THE ONLY THING THAT DISTINGUISHES THE TWO WAYS OF GETTING NOTHING.
   * A search engine that has blocked us returns an empty result list inside a
   * perfectly well-formed success response — measured live, where a first-boot
   * browser profile on a datacenter address was handed Google's
   * `/sorry/index` interstitial and the call came back `200 {results: []}`.
   * That is indistinguishable from "the web has nothing on this title" unless
   * the service says so, and it does: unresponsive engines and partial scrape
   * failures arrive here rather than as an error status.
   */
  warnings: string[]
}

export interface CrwSearchParams {
  baseUrl: string
  apiKey?: string
  maxResults?: number
  maxContentChars?: number
  timeoutMs?: number
  /** Per-result page budget. See CrwConfig.pageTimeoutMs; sent after {@link effectivePageTimeoutMs}. */
  pageTimeoutMs?: number
  /**
   * One engine per request. Omitted, CRW uses its own default, which is
   * Google — there is no server-side setting for this, the choice only exists
   * on the request.
   */
  engine?: CrwSearchEngine
}

/** Hostname without `www.`, or '' when the URL is unusable. */
export function urlDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** First string present at any of these keys, trimmed. */
function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * Read one result out of the response.
 *
 * Field names are accepted liberally — see the module header. `markdown` is
 * also looked for one level down, because a scrape result is sometimes nested
 * under the search hit rather than flattened into it.
 */
function readResult(raw: unknown, maxContentChars: number): CrwSearchResultItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>

  const url = pickString(item, ['url', 'link', 'sourceURL', 'source_url'])
  const title = pickString(item, ['title', 'name', 'heading'])

  let markdown = pickString(item, ['markdown', 'content', 'text', 'raw_content', 'rawContent'])
  if (!markdown) {
    for (const key of ['scrape', 'document', 'page', 'data']) {
      const nested = item[key]
      if (nested && typeof nested === 'object') {
        markdown = pickString(nested as Record<string, unknown>, [
          'markdown',
          'content',
          'text',
        ])
        if (markdown) break
      }
    }
  }

  // A hit with neither a URL nor any text tells us nothing and would only take
  // up a slot in the source block.
  if (!url && !markdown) return null

  return {
    title: title || urlDomain(url) || 'Untitled',
    url,
    domain: urlDomain(url),
    markdown: markdown.slice(0, maxContentChars),
  }
}

/** Pull the results array out of whichever envelope the service used. */
function readResultsArray(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json
  if (!json || typeof json !== 'object') return null
  const body = json as Record<string, unknown>
  for (const key of ['results', 'data', 'items', 'hits']) {
    if (Array.isArray(body[key])) return body[key] as unknown[]
  }
  // `{ data: { results: [...] } }` — one more level, then give up.
  const data = body.data
  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>
    for (const key of ['results', 'items', 'hits']) {
      if (Array.isArray(nested[key])) return nested[key] as unknown[]
    }
  }
  return null
}

/** Non-empty strings from `value`, whether it is one string or an array. */
function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed && !into.includes(trimmed)) into.push(trimmed)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, into)
  }
}

/**
 * Soft-failure notices from anywhere the service might have put them.
 *
 * The documented shape is `{ data: { warnings: [...] }, warning: "..." }` — a
 * plural list of engine-level problems inside the payload, and a singular
 * scalar beside it for a partial scrape failure. Both are read, along with the
 * flattened variants, for the same reason the result reader is liberal: this is
 * a young project and a shape difference should cost a diagnostic, not throw.
 *
 * Pure and exported so the reading is testable without a service to answer.
 */
export function readCrwWarnings(json: unknown): string[] {
  const out: string[] = []
  if (!json || typeof json !== 'object') return out
  const body = json as Record<string, unknown>

  collectStrings(body.warnings, out)
  collectStrings(body.warning, out)

  const data = body.data
  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>
    collectStrings(nested.warnings, out)
    collectStrings(nested.warning, out)
  }

  return out
}

/**
 * What the Test button should say, given what a real search came back with.
 *
 * ZERO RESULTS IS A FAILURE HERE, and that is the whole point of this function.
 * The probe query is deliberately banal, so a working metasearch cannot answer
 * it with nothing — an empty list means the search backend is blocked, throttled
 * or misconfigured, not that the query was hard. Reporting that as
 * "Connected. Search returned 0 result(s)." was technically true and completely
 * useless: it renders as a green tick over a retrieval service that cannot
 * retrieve, which is precisely the silent-zero this integration is written to
 * avoid everywhere else.
 *
 * Warnings ride along in both directions. On a failure they usually name the
 * cause outright ("search engine 'google' ..."), which is the difference
 * between a diagnosis and a shrug; on a success they still matter, because a
 * degraded engine is worth knowing about before a library-wide batch.
 *
 * Pure, so the decision is testable without stubbing fetch.
 */
export function describeTestOutcome(input: {
  resultCount: number
  warnings: string[]
}): { success: boolean; message: string } {
  const suffix = input.warnings.length ? ` Service reported: ${input.warnings.join('; ')}` : ''

  if (input.resultCount === 0) {
    return {
      success: false,
      message:
        'Connected, but the search returned no results. The service is reachable and its ' +
        'search endpoint answered, so this points at the search backend itself — a blocked ' +
        'or rate-limited engine, or a missing search sidecar.' +
        (suffix || ' The service reported no reason.'),
    }
  }

  return {
    success: true,
    message: `Connected. Search returned ${input.resultCount} result(s).${suffix}`,
  }
}

/**
 * Search and scrape in one call.
 *
 * Throws {@link CrwError} on a non-2xx response or a network/timeout failure,
 * both recorded to `api_errors` under the 'crw' provider (deduped). Callers in
 * the analysis path let it throw: no row is written, so the title stays pending
 * and the next run retries it.
 */
export async function crwSearch(
  query: string,
  params: CrwSearchParams
): Promise<CrwSearchResponse> {
  const baseUrl = params.baseUrl?.trim().replace(/\/+$/, '')
  if (!baseUrl) {
    throw new CrwError('The retrieval service base URL is not set', 0)
  }

  const maxContentChars = clampContentChars(
    params.maxContentChars ?? DEFAULT_CRW_CONFIG.maxContentChars
  )
  const endpoint = `${baseUrl}/v1/search`
  const timeoutMs = clampTimeout(params.timeoutMs ?? DEFAULT_CRW_CONFIG.timeoutMs)
  const pageTimeoutMs = effectivePageTimeoutMs(
    params.pageTimeoutMs ?? DEFAULT_CRW_CONFIG.pageTimeoutMs,
    timeoutMs
  )

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (params.apiKey?.trim()) headers.Authorization = `Bearer ${params.apiKey.trim()}`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query,
        limit: clampMaxResults(params.maxResults ?? DEFAULT_CRW_CONFIG.maxResults),
        // A single-element list: see CrwConfig.searchEngines for why several
        // engines in one request is not the fallback it looks like.
        ...(params.engine ? { engines: [params.engine] } : {}),
        // The point of the whole integration: fetch each hit and hand back
        // cleaned markdown, rather than returning links for a second round trip.
        //
        // `timeout` is the budget for EACH page, not the call: without it CRW
        // gives every page 15s, which is where walled pages were being lost -
        // see CrwConfig.pageTimeoutMs. A CRW older than the field ignores it.
        scrapeOptions: { formats: ['markdown'], timeout: pageTimeoutMs },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    // Network/DNS/timeout — no HTTP status. Recorded as a synthetic outage
    // (status 0) so an unreachable or misaddressed container surfaces in the
    // admin panel, which is the single most likely fault for a self-hosted
    // dependency.
    const message = err instanceof Error ? err.message : String(err)
    await recordCrwError(0, `Network/timeout: ${message}`)
    throw new CrwError(`Retrieval request failed: ${message}`, 0)
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    await recordCrwError(response.status, bodyText)
    throw new CrwError(
      `Retrieval service returned ${response.status}: ${bodyText.slice(0, 200)}`,
      response.status
    )
  }

  const json = (await response.json().catch(() => null)) as unknown
  const rawResults = readResultsArray(json)

  if (rawResults === null) {
    // A 200 whose body we cannot read is a configuration/version problem, and
    // it is silent by nature: every title would simply return no sources. Log
    // the keys actually present so it is diagnosable from one line.
    logger.error(
      {
        endpoint,
        bodyKeys: json && typeof json === 'object' ? Object.keys(json) : typeof json,
      },
      'Retrieval response had no recognisable results array'
    )
    await recordCrwError(response.status, 'Unrecognised response shape from /v1/search')
    throw new CrwError('Retrieval service returned an unrecognised response shape', response.status)
  }

  const results = rawResults
    .map((raw) => readResult(raw, maxContentChars))
    .filter((r): r is CrwSearchResultItem => r !== null)

  const warnings = readCrwWarnings(json)

  // Logged at warn rather than folded into the debug line below, because this
  // is the one signal that explains a thin or empty retrieval — and it arrives
  // on a 200, so nothing else in the pipeline will ever mention it.
  if (warnings.length > 0) {
    logger.warn({ query, warnings, usable: results.length }, 'Retrieval reported warnings')
  }

  // INFO. `returned` vs `usable` vs `withText` is the whole diagnosis of a bad
  // retrieval — a search that answered but scraped nothing looks identical to a
  // healthy one from every other vantage point — and at debug none of it
  // reached the container log under the default level.
  logger.info(
    {
      query,
      returned: rawResults.length,
      usable: results.length,
      withText: results.filter((r) => r.markdown.length > 0).length,
    },
    'Retrieval completed'
  )

  return { query, results, warnings }
}

/**
 * Verify the service answers and that SEARCH specifically works.
 *
 * Deliberately a real query rather than a health ping: the documented footgun is
 * running the bare single container, which serves /v1/scrape happily while
 * /v1/search reports that search is disabled. A health check would pass on
 * exactly the broken configuration this button exists to catch.
 *
 * It catches a second, quieter one now. Reaching the service and getting a
 * well-formed empty answer is ALSO a broken setup — see {@link describeTestOutcome}
 * — so the probe judges the results, not just the round trip.
 *
 * It walks the SAME engine cascade the job does, and says which one answered.
 * Testing one engine while the job tries three would make the button lie in
 * both directions: green while every real run fails over, or red while the job
 * is perfectly healthy on a fallback.
 */
export async function testCrwConnection(
  params: CrwSearchParams & { engines?: CrwSearchEngine[] }
): Promise<{ success: boolean; message: string; resultCount?: number; engine?: CrwSearchEngine }> {
  const engines = params.engines?.length ? params.engines : [undefined]
  const attempts: string[] = []

  for (const engine of engines) {
    try {
      const res = await crwSearch('film criticism', { ...params, maxResults: 1, engine })
      const outcome = describeTestOutcome({
        resultCount: res.results.length,
        warnings: res.warnings,
      })
      if (outcome.success) {
        // The working engine is named even on success, because "it works" and
        // "it works because it quietly fell back" are different facts about a
        // deployment and only one of them needs attention.
        const via = engine ? ` (via ${engine})` : ""
        const skipped = attempts.length ? ` Skipped — ${attempts.join(" | ")}.` : ""
        return {
          success: true,
          message: `${outcome.message}${via}${skipped}`,
          resultCount: res.results.length,
          ...(engine ? { engine } : {}),
        }
      }
      attempts.push(`${engine ?? "default"}: ${outcome.message}`)
    } catch (err) {
      // A transport failure is a fact about the SERVICE, not about this engine,
      // so there is nothing to fall back to and trying the rest would just
      // repeat the same error two more times before saying so.
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, message }
    }
  }

  return { success: false, message: `No engine returned results. ${attempts.join(' | ')}` }
}

/** Record a CRW failure to the api_errors sink (deduped). Never throws. */
async function recordCrwError(status: number, detail: string): Promise<void> {
  try {
    const parsed = parseApiError('crw', status, { errorMessage: detail.slice(0, 300) })
    const recent = await hasRecentSimilarError('crw', parsed.definition.type, status)
    if (!recent) await logApiError(parsed)
  } catch (e) {
    logger.warn({ error: e, status }, 'Failed to record CRW error to api_errors')
  }
}
