/**
 * The instrumented `fetch` every metered provider is built from.
 *
 * WHY THE CAPTURE POINT IS A FETCH. There are two dozen generateText /
 * generateObject / streamText call sites spread across core and the API, and
 * more arrive with every feature. Instrumenting each would be a permanent tax
 * that a new call site silently avoids paying. One instrumented fetch sees all
 * of them, streaming included, and cannot be forgotten.
 *
 * WHY IT IS SHARED. This module is the scaffolding that was private to
 * `openrouter-usage.ts` until Z.AI needed the same thing: read the request to
 * learn the model, tee the response so the caller is untouched, scan the copy
 * for a `usage` object, time it, and write one ledger row. None of that is
 * OpenRouter-specific. What IS provider-specific is exactly two things — how to
 * read a chunk, and how (or whether) to price the result — so those are the two
 * things a provider supplies.
 *
 * TWO RULES THE INTERCEPTION OBEYS, and they are the whole contract:
 *   - It never changes what the caller sees. The response is teed; the consumer
 *     gets an untouched branch and the scanner reads the copy.
 *   - It never fails the call. Every parse, every insert, every await is inside
 *     a catch — a metering bug must not become an inference outage.
 */
import { createChildLogger } from './logger.js'
import { getInferenceContext } from './inferenceContext.js'
import { recordInferenceCall, type InferenceCallStatus } from './inferenceUsage.js'

const logger = createChildLogger('usage-fetch')

/**
 * Guard against buffering a pathological response into memory. Real completions
 * are orders of magnitude below this; past it we stop scanning and record the
 * call with whatever we already saw.
 */
const MAX_SCAN_BYTES = 8 * 1024 * 1024

/**
 * What a scan managed to learn. Every field is optional because every field is
 * a claim some provider does not make — and a claim nobody made must reach the
 * ledger as absent rather than as zero.
 */
export interface ParsedUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedTokens?: number
  /** USD. Only ever set by a provider that reports what it charged. */
  cost?: number
  upstreamCost?: number
  generationId?: string
  upstreamProvider?: string
}

/** Number, or nothing. `NaN`, `null` and a numeric string all read as nothing. */
export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Read the token counts out of an OpenAI-shaped `usage` object.
 *
 * Both spellings are read because this runs against raw HTTP while the shapes
 * are documented in snake_case and handed back by some SDKs in camelCase.
 *
 * `reasoning_tokens` is a BREAKDOWN of `completion_tokens`, not an addition to
 * it — every provider that reports both counts the scratchpad inside the
 * completion total. Anything pricing these must not add them again.
 */
export function readOpenAiUsage(usage: Record<string, unknown>, into: ParsedUsage): void {
  into.promptTokens = num(usage.prompt_tokens) ?? num(usage.promptTokens) ?? into.promptTokens
  into.completionTokens =
    num(usage.completion_tokens) ?? num(usage.completionTokens) ?? into.completionTokens
  into.totalTokens = num(usage.total_tokens) ?? num(usage.totalTokens) ?? into.totalTokens

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
}

/** Reads one decoded response chunk into the accumulator. Provider-specific. */
export type ChunkReader = (chunk: Record<string, unknown>, into: ParsedUsage) => void

/**
 * Read a copy of the response body far enough to find the usage object.
 *
 * Streaming puts it in the last SSE message, so every `data:` line is parsed and
 * the last one carrying usage wins; non-streaming has it in the single JSON
 * body. Both cases tolerate junk — a line that won't parse is skipped, not
 * thrown.
 */
async function scanBody(
  body: ReadableStream<Uint8Array>,
  isSse: boolean,
  readChunk: ChunkReader
): Promise<ParsedUsage> {
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
        logger.debug('Response exceeded the usage scan limit; stopping early')
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

export interface MeteredFetchOptions {
  /** Ledger provider id. Must match what the read side scopes on. */
  provider: string
  /**
   * AI role, baked in at provider-creation time because the HTTP layer has no
   * other way to know it — the model instance is built per AI function, so a
   * role-bound fetch is the cheapest honest attribution available. Everything
   * else (feature, session, user) comes from the ambient inference context.
   */
  role?: string
  readChunk: ChunkReader
  /**
   * Turn measured tokens into USD, for a provider that reports counts but not
   * money. Return `undefined` when the model has no published price — the row
   * then carries counts and no cost, which the read side reports separately.
   *
   * Never called when the scan already found a real `cost`: a number the
   * provider charged always beats a number we computed.
   */
  priceCall?: (model: string, usage: ParsedUsage) => number | undefined
}

/**
 * A `fetch` that records every call it makes to the inference ledger.
 *
 * The response is teed rather than read: the caller gets an untouched branch and
 * the meter reads the copy, so a streamed answer still reaches the UI token by
 * token while the usage chunk at the end is captured.
 */
export function createMeteredFetch(options: MeteredFetchOptions): typeof fetch {
  const { provider, role, readChunk, priceCall } = options

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
      // A provider that bills us wins over a price we computed. Both being
      // absent is a real answer — counts without money — and must not become 0.
      let cost = usage.cost
      if (cost == null && priceCall) {
        try {
          cost = priceCall(facts.model, usage)
        } catch (err) {
          logger.warn({ err, provider, model: facts.model }, 'Failed to price call')
        }
      }

      void recordInferenceCall({
        provider,
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
        cost,
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
      void scanBody(forMeter, isSse, readChunk)
        .then((usage) => record('ok', response.status, usage))
        .catch((err) => {
          logger.warn({ err, provider }, 'Failed to scan response for usage')
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
      logger.warn({ err, provider }, 'Failed to tee response; skipping usage capture')
      record('ok', response.status, {})
      return response
    }
  }
}
