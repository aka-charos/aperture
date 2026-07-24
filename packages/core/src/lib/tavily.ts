/**
 * Tavily Search API integration.
 *
 * Tavily (https://tavily.com) is an optional web-search grounding source for the
 * AI assistant's discovery pipeline. Unlike the Google grounding role — an LLM
 * that both searches and reasons — Tavily is a pure search API: it returns web
 * result snippets plus an optional synthesized answer, which the discovery
 * pipeline feeds (alongside any other source) into a single structuring pass to
 * produce movie/series candidates.
 *
 * It can run as an additional grounding source, or as a fallback when Google
 * grounding is rate-limited/empty. Config is a single JSON blob in
 * `system_settings` (mirrors the n8n integration); enablement is an explicit
 * `enabled` flag plus a present API key. HTTP failures are recorded to
 * `api_errors` under the 'tavily' provider so they surface in the admin panel.
 */
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { createChildLogger } from './logger.js'
import { parseApiError, logApiError, hasRecentSimilarError } from '../errors/index.js'

const logger = createChildLogger('tavily')

export type TavilySearchDepth = 'basic' | 'advanced'
export type TavilyTopic = 'general' | 'news'
export type TavilyTimeRange = 'day' | 'week' | 'month' | 'year' | null

export interface TavilyConfig {
  /** Master switch; discovery uses Tavily only when this is true and a key is set. */
  enabled: boolean
  apiKey: string
  /** Number of web results to return (1–20). */
  maxResults: number
  /** 'basic' (fast) or 'advanced' (deeper, costs more credits). */
  searchDepth: TavilySearchDepth
  /** Ask Tavily for a synthesized answer to the query (extra grounding text). */
  includeAnswer: boolean
  /** Include image URLs in results (unused by discovery today; here for parity). */
  includeImages: boolean
  /** 'general' (default) or 'news' (recency-weighted, good for "trending"). */
  topic: TavilyTopic
  /** Restrict to a recent window (for trending queries); null = no restriction. */
  timeRange: TavilyTimeRange
}

export const DEFAULT_TAVILY_CONFIG: TavilyConfig = {
  enabled: false,
  apiKey: '',
  maxResults: 5,
  searchDepth: 'basic',
  includeAnswer: true,
  includeImages: false,
  topic: 'general',
  timeRange: null,
}

const SETTING_KEY = 'tavily_integration'
const TAVILY_ENDPOINT = 'https://api.tavily.com/search'
const TAVILY_TIMEOUT_MS = 15000

function clampMaxResults(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TAVILY_CONFIG.maxResults
  return Math.min(20, Math.max(1, Math.trunc(n)))
}

export async function getTavilyConfig(): Promise<TavilyConfig> {
  const json = await getSystemSetting(SETTING_KEY)
  if (json) {
    try {
      const parsed = JSON.parse(json) as Partial<TavilyConfig>
      // Merge over defaults so a blob written before a new field was added still
      // returns a complete, well-typed config.
      return {
        ...DEFAULT_TAVILY_CONFIG,
        ...parsed,
        maxResults: clampMaxResults(parsed.maxResults ?? DEFAULT_TAVILY_CONFIG.maxResults),
      }
    } catch (e) {
      logger.error({ error: e }, 'Failed to parse tavily_integration config')
    }
  }
  return { ...DEFAULT_TAVILY_CONFIG }
}

export async function setTavilyConfig(config: TavilyConfig): Promise<void> {
  const sanitized: TavilyConfig = { ...config, maxResults: clampMaxResults(config.maxResults) }
  await setSystemSetting(
    SETTING_KEY,
    JSON.stringify(sanitized),
    'Tavily web search integration for the AI assistant discovery pipeline'
  )
  logger.info('Tavily integration configuration updated')
}

/** True when Tavily should participate in discovery (enabled + key present). */
export function isTavilyEnabled(config: TavilyConfig): boolean {
  return config.enabled && !!config.apiKey.trim()
}

export class TavilyError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'TavilyError'
    this.status = status
  }
}

export interface TavilySearchResultItem {
  title: string
  url: string
  content: string
  score?: number
}

export interface TavilySearchResponse {
  query: string
  answer?: string
  results: TavilySearchResultItem[]
  images?: string[]
  responseTime?: number
}

/** Per-request search parameters. `apiKey` is required; the rest fall back to sane defaults. */
export interface TavilySearchParams {
  apiKey: string
  maxResults?: number
  searchDepth?: TavilySearchDepth
  includeAnswer?: boolean
  includeImages?: boolean
  topic?: TavilyTopic
  timeRange?: TavilyTimeRange
}

/**
 * Run a Tavily search. Throws {@link TavilyError} on a non-2xx response (also
 * recorded to `api_errors` under the 'tavily' provider, deduped) or on a
 * network/timeout failure. Callers in the fail-open discovery path catch and
 * degrade to the other sources.
 */
export async function tavilySearch(
  query: string,
  params: TavilySearchParams
): Promise<TavilySearchResponse> {
  if (!params.apiKey?.trim()) {
    throw new TavilyError('Tavily API key is not set', 401)
  }

  const body: Record<string, unknown> = {
    query,
    search_depth: params.searchDepth ?? DEFAULT_TAVILY_CONFIG.searchDepth,
    topic: params.topic ?? DEFAULT_TAVILY_CONFIG.topic,
    max_results: clampMaxResults(params.maxResults ?? DEFAULT_TAVILY_CONFIG.maxResults),
    include_answer: params.includeAnswer ?? DEFAULT_TAVILY_CONFIG.includeAnswer,
    include_images: params.includeImages ?? DEFAULT_TAVILY_CONFIG.includeImages,
  }
  if (params.timeRange) body.time_range = params.timeRange

  let response: Response
  try {
    response = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey.trim()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
    })
  } catch (err) {
    // Network/timeout — no HTTP status to classify; surface as a TavilyError.
    const message = err instanceof Error ? err.message : String(err)
    throw new TavilyError(`Tavily request failed: ${message}`)
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    await recordTavilyHttpError(response.status, bodyText)
    throw new TavilyError(`Tavily returned ${response.status}: ${bodyText.slice(0, 200)}`, response.status)
  }

  const json = (await response.json()) as {
    query?: string
    answer?: string
    results?: Array<{ title?: string; url?: string; content?: string; score?: number }>
    images?: unknown
    response_time?: number
  }

  const results: TavilySearchResultItem[] = (json.results ?? [])
    .filter((r) => r && (r.title || r.content))
    .map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: r.content ?? '',
      score: r.score,
    }))

  return {
    query: json.query ?? query,
    answer: typeof json.answer === 'string' ? json.answer : undefined,
    results,
    images: Array.isArray(json.images)
      ? json.images.filter((i): i is string => typeof i === 'string')
      : undefined,
    responseTime: json.response_time,
  }
}

/** Record a Tavily HTTP failure to the api_errors sink (deduped). Never throws. */
async function recordTavilyHttpError(status: number, bodyText: string): Promise<void> {
  try {
    const parsed = parseApiError('tavily', status, { errorMessage: bodyText.slice(0, 300) })
    const recent = await hasRecentSimilarError('tavily', parsed.definition.type, status)
    if (!recent) await logApiError(parsed)
  } catch (e) {
    logger.warn({ error: e, status }, 'Failed to record Tavily error to api_errors')
  }
}
