/**
 * OpenRouter usage accounting.
 *
 * OpenRouter returns a `usage` object on every response carrying the token
 * counts *and* the credits the call actually cost
 * (https://openrouter.ai/docs/use-cases/usage-accounting). That is the one
 * provider we can bill precisely rather than estimate, so it gets a real ledger.
 *
 * The capture point is the provider's `fetch`, not the call sites. There are two
 * dozen generateText/generateObject/streamText calls spread across core and the
 * API, and more arrive with every feature; instrumenting each would be a
 * permanent tax that a new call site silently avoids paying. One instrumented
 * fetch sees all of them, streaming included, and cannot be forgotten.
 *
 * Two rules the interception obeys:
 *   - It never changes what the caller sees. The response is teed; the consumer
 *     gets an untouched branch and the scanner reads the copy.
 *   - It never fails the call. Every parse, every insert, every await is inside a
 *     catch — a metering bug must not become an inference outage.
 */
import { createChildLogger } from './logger.js'
import { getInferenceContext } from './inferenceContext.js'
import { recordInferenceCall, type InferenceCallStatus } from './inferenceUsage.js'

const logger = createChildLogger('openrouter-usage')

const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key'

/**
 * Guard against buffering a pathological response into memory. Real completions
 * are orders of magnitude below this; past it we stop scanning and record the
 * call with whatever we already saw.
 */
const MAX_SCAN_BYTES = 8 * 1024 * 1024

// ============================================================================
// Parsing the usage object
// ============================================================================

interface ParsedUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedTokens?: number
  cost?: number
  upstreamCost?: number
  generationId?: string
  upstreamProvider?: string
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Pull what we need out of one response chunk. Reads both the snake_case wire
 * format and the camelCase the SDK sometimes hands back, because this runs
 * against raw HTTP but the shapes are documented in both.
 */
function readChunk(chunk: Record<string, unknown>, into: ParsedUsage): void {
  if (typeof chunk.id === 'string' && chunk.id) into.generationId = chunk.id
  if (typeof chunk.provider === 'string' && chunk.provider) into.upstreamProvider = chunk.provider

  const usage = chunk.usage as Record<string, unknown> | undefined
  if (!usage || typeof usage !== 'object') return

  into.promptTokens = num(usage.prompt_tokens) ?? num(usage.promptTokens) ?? into.promptTokens
  into.completionTokens =
    num(usage.completion_tokens) ?? num(usage.completionTokens) ?? into.completionTokens
  into.totalTokens = num(usage.total_tokens) ?? num(usage.totalTokens) ?? into.totalTokens
  into.cost = num(usage.cost) ?? into.cost

  const promptDetails = (usage.prompt_tokens_details ?? usage.promptTokensDetails) as
    | Record<string, unknown>
    | undefined
  if (promptDetails) {
    into.cachedTokens =
      num(promptDetails.cached_tokens) ?? num(promptDetails.cachedTokens) ?? into.cachedTokens
  }

  const completionDetails = (usage.completion_tokens_details ?? usage.completionTokensDetails) as
    | Record<string, unknown>
    | undefined
  if (completionDetails) {
    into.reasoningTokens =
      num(completionDetails.reasoning_tokens) ??
      num(completionDetails.reasoningTokens) ??
      into.reasoningTokens
  }

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

/**
 * Read a copy of the response body far enough to find the usage object.
 *
 * Streaming puts it in the last SSE message, so every `data:` line is parsed and
 * the last one carrying usage wins; non-streaming has it in the single JSON body.
 * Both cases tolerate junk — a line that won't parse is skipped, not thrown.
 */
async function scanBody(body: ReadableStream<Uint8Array>, isSse: boolean): Promise<ParsedUsage> {
  const parsed: ParsedUsage = {}
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let seenBytes = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      seenBytes += value.byteLength
      if (seenBytes > MAX_SCAN_BYTES) {
        logger.debug('OpenRouter response exceeded the usage scan limit; stopping early')
        break
      }

      buffer += decoder.decode(value, { stream: true })

      if (!isSse) continue

      // SSE: complete lines only; the tail stays in the buffer for the next read.
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          readChunk(JSON.parse(payload) as Record<string, unknown>, parsed)
        } catch {
          // A partial or non-JSON data line. The usage chunk will come again.
        }
      }
    }

    if (!isSse && buffer.trim()) {
      try {
        readChunk(JSON.parse(buffer) as Record<string, unknown>, parsed)
      } catch {
        // Not JSON (an HTML error page from a proxy, say) — nothing to bill.
      }
    }
  } finally {
    // Let the tee drop its buffer even when we bailed out early.
    void reader.cancel().catch(() => {})
  }

  return parsed
}

// ============================================================================
// The instrumented fetch
// ============================================================================

interface RequestFacts {
  model: string
  streamed: boolean
}

/** What the request asked for, so a failed call can still be attributed. */
function readRequestFacts(init: RequestInit | undefined): RequestFacts {
  const fallback: RequestFacts = { model: 'unknown', streamed: false }
  const body = init?.body
  if (typeof body !== 'string') return fallback

  try {
    const parsed = JSON.parse(body) as { model?: unknown; stream?: unknown }
    return {
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : fallback.model,
      streamed: parsed.stream === true,
    }
  } catch {
    return fallback
  }
}

function stripBodyEncodingHeaders(headers: Headers): Headers {
  const copy = new Headers(headers)
  copy.delete('content-encoding')
  copy.delete('content-length')
  return copy
}

/**
 * A `fetch` for the OpenRouter provider that records every call to the ledger.
 *
 * `role` is baked in at provider-creation time because the HTTP layer has no
 * other way to know it — the model instance is built per AI function, so a
 * role-bound fetch is the cheapest honest attribution available. Everything else
 * (feature, session, user) comes from the ambient inference context, snapshotted
 * when the request starts rather than when the stream finishes.
 */
export function createOpenRouterUsageFetch(role?: string): typeof fetch {
  // Parameters<typeof fetch> rather than RequestInfo: core builds without the
  // DOM lib, and Node only supplies some of the fetch globals as types.
  return async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ): Promise<Response> => {
    const startedAt = Date.now()
    const facts = readRequestFacts(init)
    const context = getInferenceContext()

    const record = (
      status: InferenceCallStatus,
      statusCode: number | undefined,
      usage: ParsedUsage
    ) => {
      void recordInferenceCall({
        provider: 'openrouter',
        model: facts.model,
        role,
        feature: context?.feature,
        sessionId: context?.sessionId,
        userId: context?.userId,
        generationId: usage.generationId,
        upstreamProvider: usage.upstreamProvider,
        status,
        statusCode,
        streamed: facts.streamed,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        reasoningTokens: usage.reasoningTokens,
        cachedTokens: usage.cachedTokens,
        totalTokens: usage.totalTokens,
        cost: usage.cost,
        upstreamCost: usage.upstreamCost,
        latencyMs: Date.now() - startedAt,
      })
    }

    let response: Response
    try {
      response = await fetch(input, init)
    } catch (err) {
      // Network-level failure: no status, no tokens, but it still happened.
      record('error', undefined, {})
      throw err
    }

    // A rejected request costs nothing and its body belongs to the SDK's error
    // reporting — take the status and stay out of the way.
    if (!response.ok || !response.body) {
      record(response.ok ? 'ok' : 'error', response.status, {})
      return response
    }

    try {
      const [forCaller, forMeter] = response.body.tee()
      const isSse = (response.headers.get('content-type') ?? '').includes('text/event-stream')

      // Floating on purpose: the caller must not wait for metering, and for a
      // stream this only resolves once the consumer has drained its branch.
      void scanBody(forMeter, isSse)
        .then((usage) => record('ok', response.status, usage))
        .catch((err) => {
          logger.warn({ err }, 'Failed to scan OpenRouter response for usage')
          record('ok', response.status, {})
        })

      return new Response(forCaller, {
        status: response.status,
        statusText: response.statusText,
        // `response.body` is already decoded, but the headers still describe the
        // compressed payload. Carrying them over would advertise a length and an
        // encoding that no longer match the bytes.
        headers: stripBodyEncodingHeaders(response.headers),
      })
    } catch (err) {
      // Teeing failed — hand back the original untouched rather than lose the call.
      logger.warn({ err }, 'Failed to tee OpenRouter response; skipping usage capture')
      record('ok', response.status, {})
      return response
    }
  }
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
