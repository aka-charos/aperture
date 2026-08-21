/**
 * Error classification for the AI Assistant.
 *
 * Failures are classified into stable machine-readable codes so the frontend
 * can show a localized, actionable message instead of a masked generic one.
 * Stream-level errors travel as `AI_ERROR:<code>:<detail>` strings (parsed in
 * web's Thread.tsx); tool-level errors become `{ id, error }` payloads that
 * ToolResultError renders.
 */
import { APICallError, LoadAPIKeyError, RetryError } from 'ai'
import {
  parseApiError,
  logApiError,
  hasRecentSimilarError,
  describeAiError,
} from '@aperture/core'

export type AssistantErrorCode =
  | 'not_configured'
  | 'provider_auth'
  | 'provider_quota'
  | 'provider_model'
  | 'provider_unreachable'
  | 'db_unavailable'
  | 'unknown'

/** Node/pg network-level error codes that mean "couldn't reach the database". */
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'])

/** Flatten an error's cause / retry chain (bounded — chains can be cyclic). */
function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = []
  let current = err
  for (let i = 0; i < 6 && current != null; i++) {
    chain.push(current)
    if (RetryError.isInstance(current)) {
      current = current.lastError
    } else if (current instanceof Error && current.cause != null) {
      current = current.cause
    } else {
      break
    }
  }
  return chain
}

export function classifyAssistantError(err: unknown): AssistantErrorCode {
  for (const e of errorChain(err)) {
    if (LoadAPIKeyError.isInstance(e)) return 'provider_auth'

    if (APICallError.isInstance(e)) {
      const status = e.statusCode
      if (status === 401 || status === 403) return 'provider_auth'
      if (status === 429) return 'provider_quota'
      if (status === 404) return 'provider_model'
      // No HTTP status (network failure) or provider-side 5xx: can't reach it.
      if (status === undefined || status >= 500) return 'provider_unreachable'
      continue
    }

    if (e instanceof Error) {
      const message = e.message
      // ai-provider.ts throws "<Role> provider is not configured. Please configure it in Settings > AI."
      if (/is not configured/i.test(message)) return 'not_configured'

      // node-postgres: network errors carry Node codes; server-side connection
      // problems carry SQLSTATE class 08 (connection exception) or 57P0x
      // (shutdown); pool timeouts and terminated connections only have messages.
      const code = (e as NodeJS.ErrnoException).code
      if (code && (NETWORK_CODES.has(code) || /^08|^57P/.test(code))) return 'db_unavailable'
      if (/connection terminated|timeout exceeded when trying to connect|pool is draining/i.test(message)) {
        return 'db_unavailable'
      }
    }
  }
  return 'unknown'
}

/** First human-readable message in the chain, flattened to one bounded line. */
function errorDetail(err: unknown): string {
  const first = errorChain(err).find((e): e is Error => e instanceof Error)
  const message = first?.message ?? (typeof err === 'string' ? err : '')
  return message.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/**
 * Message for UI-message-stream error parts (toUIMessageStreamResponse onError).
 * Format: `AI_ERROR:<code>:<detail>` — the frontend maps <code> to a localized
 * message and shows <detail> as debugging context.
 */
export function assistantErrorText(err: unknown): string {
  return `AI_ERROR:${classifyAssistantError(err)}:${errorDetail(err)}`
}

/**
 * Friendly English text for tool `{ id, error }` payloads. These are read by
 * the model as tool results (so they stay English) and rendered by
 * ToolResultError, which localizes the surrounding chrome.
 */
export function toolErrorText(err: unknown): string {
  const code = classifyAssistantError(err)
  if (code === 'db_unavailable') {
    return 'The library database is unreachable right now. Please try again in a moment.'
  }
  const detail = errorDetail(err)
  return detail ? `Lookup failed: ${detail}` : 'Lookup failed due to an unexpected error.'
}

/** Providers the api_errors framework can classify for assistant LLM calls. */
type LlmErrorProvider = 'google' | 'openai'

/** Minimal pino-compatible logger surface (avoids a hard pino type dependency). */
interface LlmErrorLogger {
  warn(obj: object, msg?: string): void
}

/** HTTP status from the first APICallError in the chain, if the SDK exposed one. */
function httpStatusOf(err: unknown): number | undefined {
  for (const e of errorChain(err)) {
    if (APICallError.isInstance(e)) return e.statusCode
  }
  return undefined
}

/**
 * Surface a failed assistant LLM call that would otherwise be swallowed by a
 * fail-open path (discovery web search, intent routing). It ALWAYS logs the
 * failure — with the HTTP status when the SDK exposes one, so a Gemini 429 is
 * identifiable — and, for a provider the errors framework understands, records
 * it to the `api_errors` sink (deduped, like the integration clients) so it
 * appears in the admin API-errors panel. Never throws: callers stay fail-open.
 */
export async function recordLlmError(
  err: unknown,
  opts: { context: string; provider?: LlmErrorProvider; logger: LlmErrorLogger }
): Promise<void> {
  const { context, provider, logger } = opts
  const status = httpStatusOf(err)
  const detail = errorDetail(err)
  // Described rather than raw, for the reason documented on describeAiError:
  // pino copies an APICallError's enumerable own properties in declaration
  // order, and `requestBodyValues` comes before `statusCode` -- so `{ err }`
  // writes the whole request (a full chat prompt here) ahead of the one field
  // that identifies the fault.
  logger.warn(
    { ...describeAiError(err), context, provider },
    `Assistant LLM call failed: ${context}`
  )

  // Only persist to api_errors when we have a real HTTP status and a provider the
  // framework can classify (grounding is Google-only; chat may be another provider).
  if (!provider || typeof status !== 'number') return
  try {
    const parsed = parseApiError(provider, status, { errorMessage: detail })
    const recent = await hasRecentSimilarError(provider, parsed.definition.type, status)
    if (!recent) await logApiError(parsed)
  } catch (persistErr) {
    logger.warn({ err: persistErr, context }, 'Failed to record LLM error to api_errors')
  }
}
