/**
 * OpenRouter usage accounting.
 *
 * OpenRouter returns a `usage` object on every response carrying the token
 * counts *and* the credits the call actually cost
 * (https://openrouter.ai/docs/use-cases/usage-accounting). That makes it the one
 * provider whose ledger rows are billed rather than estimated — Z.AI's rows are
 * priced from its published catalog (see `zai-usage.ts`), and the dashboard says
 * which is which.
 *
 * The interception itself lives in `usageFetch.ts`: reading the request, teeing
 * the response, scanning for usage, timing, and writing the row are the same
 * work for every provider. What is OpenRouter's own is this file's chunk reader
 * — the generation id, the upstream provider it routed to, and the two cost
 * fields — plus the key-status lookup at the bottom.
 */
import { createChildLogger } from './logger.js'
import {
  createMeteredFetch,
  num,
  readOpenAiUsage,
  type ParsedUsage,
} from './usageFetch.js'

const logger = createChildLogger('openrouter-usage')

const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key'

// ============================================================================
// Parsing the usage object
// ============================================================================

/**
 * Pull what we need out of one response chunk.
 *
 * The token counts are the standard OpenAI shape and are read by the shared
 * helper; everything below it is OpenRouter's own. `cost` is the credits
 * actually charged and `cost_details.upstream_inference_cost` is what the
 * upstream billed OpenRouter, which is why both are kept — the gap between them
 * is OpenRouter's margin and is the number an operator asks about.
 */
function readOpenRouterChunk(chunk: Record<string, unknown>, into: ParsedUsage): void {
  if (typeof chunk.id === 'string' && chunk.id) into.generationId = chunk.id
  if (typeof chunk.provider === 'string' && chunk.provider) into.upstreamProvider = chunk.provider

  const usage = chunk.usage as Record<string, unknown> | undefined
  if (!usage || typeof usage !== 'object') return

  readOpenAiUsage(usage, into)
  into.cost = num(usage.cost) ?? into.cost

  const costDetails = (usage.cost_details ?? usage.costDetails) as
    | Record<string, unknown>
    | undefined
  if (costDetails) {
    into.upstreamCost =
      num(costDetails.upstream_inference_cost) ??
      num(costDetails.upstreamInferenceCost) ??
      into.upstreamCost
  }
}

// ============================================================================
// The instrumented fetch
// ============================================================================

/**
 * A `fetch` for the OpenRouter provider that records every call to the ledger.
 *
 * No `priceCall`: OpenRouter reports the real figure on every response, so
 * computing one from a catalog would be replacing a measurement with an
 * estimate. A response that somehow carries no cost is recorded unpriced, which
 * the dashboard counts separately rather than silently treating as free.
 */
export function createOpenRouterUsageFetch(role?: string): typeof fetch {
  return createMeteredFetch({ provider: 'openrouter', role, readChunk: readOpenRouterChunk })
}

// ============================================================================
// Account status
// ============================================================================

export interface OpenRouterAccountStatus {
  label: string | null
  /** Credit limit on this key, or null for an unlimited (paid) key. */
  limit: number | null
  limitRemaining: number | null
  isFreeTier: boolean
  usage: number
  usageDaily: number
  usageWeekly: number
  usageMonthly: number
}

interface CachedStatus {
  fetchedAt: number
  status: OpenRouterAccountStatus
}

/** The dashboard polls; OpenRouter's numbers do not move that fast. */
const STATUS_TTL_MS = 60_000
let cachedStatus: CachedStatus | null = null

/**
 * OpenRouter's own view of the key: credits left and rolling spend
 * (https://openrouter.ai/api/v1/key). This is the authority — the ledger only
 * knows about calls this instance made, whereas the key totals include every
 * other client sharing it. Returns null when the key is missing or the call
 * fails; the panel then shows the ledger alone.
 */
export async function fetchOpenRouterKeyStatus(
  apiKey: string | undefined
): Promise<OpenRouterAccountStatus | null> {
  if (!apiKey) return null

  const cached = cachedStatus
  if (cached && Date.now() - cached.fetchedAt < STATUS_TTL_MS) return cached.status

  try {
    const response = await fetch(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      logger.warn({ status: response.status }, 'OpenRouter key endpoint returned an error')
      return null
    }

    const json = (await response.json()) as {
      data?: {
        label?: string
        limit?: number | null
        limit_remaining?: number | null
        is_free_tier?: boolean
        usage?: number
        usage_daily?: number
        usage_weekly?: number
        usage_monthly?: number
      }
    }

    const data = json.data
    if (!data) return null

    const status: OpenRouterAccountStatus = {
      label: data.label ?? null,
      limit: num(data.limit) ?? null,
      limitRemaining: num(data.limit_remaining) ?? null,
      isFreeTier: data.is_free_tier === true,
      usage: num(data.usage) ?? 0,
      usageDaily: num(data.usage_daily) ?? 0,
      usageWeekly: num(data.usage_weekly) ?? 0,
      usageMonthly: num(data.usage_monthly) ?? 0,
    }

    cachedStatus = { fetchedAt: Date.now(), status }
    return status
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch OpenRouter key status')
    return null
  }
}
