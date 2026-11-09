/**
 * Backend stream errors arrive as "AI_ERROR:<code>:<detail>" (api
 * assistant/helpers/errors.ts). Each stable code maps to localized copy;
 * anything unparseable falls back to the generic message with the raw text as
 * detail. Shared by the chat and the newsletter writing assistant.
 */
const STREAM_ERROR_KEYS: Record<string, string> = {
  not_configured: 'assistant.streamErrorNotConfigured',
  provider_auth: 'assistant.streamErrorProviderAuth',
  provider_quota: 'assistant.streamErrorProviderQuota',
  provider_model: 'assistant.streamErrorProviderModel',
  provider_unreachable: 'assistant.streamErrorProviderUnreachable',
  db_unavailable: 'assistant.streamErrorDbUnavailable',
}

/** The translation key and the detail to show under it. */
export function readStreamError(raw: string): { key: string; detail: string } {
  const match = /^AI_ERROR:([a-z_]+):?([\s\S]*)$/.exec(raw)
  const key = (match ? STREAM_ERROR_KEYS[match[1]] : undefined) ?? 'assistant.streamErrorGeneric'
  return { key, detail: (match ? match[2] : raw).trim() }
}
