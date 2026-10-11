/**
 * What `setSystemSetting` may write to the log about a value it just stored.
 *
 * The log line exists so an operator can see that a setting changed, and for a
 * flag or a path the value is the useful part. For a credential it is the one
 * thing that must never appear, and the old rule — redact when the KEY looks
 * sensitive — could only recognise a credential by its name. Four integration
 * blobs (`smtp_integration`, `crw_integration`, `decision_model_integration`,
 * `translation_integration`) carry a password or an API key INSIDE a JSON
 * value under a key that names none of the trigger words, so every save of
 * them printed the secret at info level. Pino's own `redact` paths could not
 * catch it either: they match object fields, and here the whole blob is one
 * string under `value`.
 *
 * So the rule now looks at the value as well: anything shaped like a JSON
 * object or array is redacted whatever it is called. That costs nothing worth
 * having — a structured value is unreadable on one log line anyway — and it
 * means the next integration blob is safe without anyone remembering to add its
 * name to a list.
 *
 * Pure, so it is pinned without a database.
 */

/** Scalar settings whose names do not give them away. */
const SENSITIVE_SETTING_KEYS = new Set([
  'media_server_api_key',
  'openai_api_key',
  'tmdb_api_key',
  'omdb_api_key',
  'trakt_client_secret',
])

const SENSITIVE_NAME_PARTS = ['api_key', 'secret', 'password', 'token', 'credential']

export const REDACTED_SETTING_VALUE = '[REDACTED]'

export function isSensitiveSettingKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_SETTING_KEYS.has(lower) || SENSITIVE_NAME_PARTS.some((part) => lower.includes(part))
}

/** A JSON object or array, judged by its first non-blank character. */
function looksStructured(value: string): boolean {
  const first = value.trimStart()[0]
  return first === '{' || first === '['
}

/** The value as it may appear in a log line. */
export function loggableSettingValue(key: string, value: string): string {
  if (isSensitiveSettingKey(key) || looksStructured(value)) return REDACTED_SETTING_VALUE
  return value
}
