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
