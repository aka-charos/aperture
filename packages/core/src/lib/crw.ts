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

const logger = createChildLogger('crw')

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
   * Hard per-result cap on returned markdown (1,000–100,000).
   *
   * This is a SAFETY VALVE, not the token budget. A single pathological page
   * should not be able to blow up JSON parsing or memory; deciding how much
   * text the model actually sees is the analysis module's job, because only it
   * knows the target model's context window.
   */
  maxContentChars: number
  /**
   * Whole-request timeout (5,000–300,000 ms). Generous by default: this one
   * call runs a metasearch and then fetches several pages, and a JS-rendering
   * fallback makes it slower still.
   *
   * THE DEFAULT IS SET BY A NUMBER THE SERVICE PRINTS AT BOOT, not by taste.
   * CRW's render ladder is HTTP → LightPanda → the heavy browser tier, and with
   * `auto_extend_deadline_for_ladder` on (the shipped default) a single page
   * that reaches the heavy tier is allowed the whole ladder. A stock deployment
   * logs its own arithmetic on startup:
   *
   *   deadline_ms_default=15000 ladder_min_ms=82500 effective_default_ms=82500
   *
   * So ONE slow page can occupy 82.5s, and search runs before any of it. The
   * previous 90s default sat under the worst case with the search leg
   * unaccounted for — and a timeout here throws, which writes no row, so the
   * title silently stays pending and the work is simply lost. Grep the boot log
   * for `ladder_min_ms` and keep this comfortably above it plus the search leg.
   */
  timeoutMs: number
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
}

export const DEFAULT_CRW_CONFIG: CrwConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  maxResults: 6,
  maxContentChars: 12000,
  timeoutMs: 180000,
  sourceBudgetChars: 16000,
}

const SETTING_KEY = 'crw_integration'

const clampInt = (n: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

const clampMaxResults = (n: number) => clampInt(n, 1, 20, DEFAULT_CRW_CONFIG.maxResults)
const clampContentChars = (n: number) =>
  clampInt(n, 1000, 100_000, DEFAULT_CRW_CONFIG.maxContentChars)
const clampTimeout = (n: number) => clampInt(n, 5000, 300_000, DEFAULT_CRW_CONFIG.timeoutMs)
const clampSourceBudget = (n: number) =>
  clampInt(n, 2000, 200_000, DEFAULT_CRW_CONFIG.sourceBudgetChars)

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
    maxContentChars: clampContentChars(
      config.maxContentChars ?? DEFAULT_CRW_CONFIG.maxContentChars
    ),
    timeoutMs: clampTimeout(config.timeoutMs ?? DEFAULT_CRW_CONFIG.timeoutMs),
    sourceBudgetChars: clampSourceBudget(
      config.sourceBudgetChars ?? DEFAULT_CRW_CONFIG.sourceBudgetChars
    ),
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
        // The point of the whole integration: fetch each hit and hand back
        // cleaned markdown, rather than returning links for a second round trip.
        scrapeOptions: { formats: ['markdown'] },
      }),
      signal: AbortSignal.timeout(clampTimeout(params.timeoutMs ?? DEFAULT_CRW_CONFIG.timeoutMs)),
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
 */
export async function testCrwConnection(
  params: CrwSearchParams
): Promise<{ success: boolean; message: string; resultCount?: number }> {
  try {
    const res = await crwSearch('film criticism', { ...params, maxResults: 1 })
    const outcome = describeTestOutcome({
      resultCount: res.results.length,
      warnings: res.warnings,
    })
    return { ...outcome, resultCount: res.results.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, message }
  }
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
