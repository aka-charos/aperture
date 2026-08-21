/**
 * Compact, loggable descriptions of a failed AI SDK call.
 *
 * WHY THIS EXISTS. `APICallError` carries the provider's status and response
 * body -- the only two things that say what actually went wrong -- but it sets
 * `url` and `requestBodyValues` FIRST, and pino's error serializer copies every
 * enumerable own property in declaration order. `requestBodyValues` holds the
 * entire request, which for title analysis is ~16 KB of scraped article text.
 * So a failure logged as `{ err }` produces one enormous line whose useful part
 * is at the very end, past the point any terminal, `docker logs | tail`, or
 * copy-paste realistically reaches.
 *
 * Measured: a title-analysis failure against OpenRouter logged the message
 * "Provider returned error" and then the whole prompt. The status code was
 * present and unreadable, so the same unusable line had to be pasted twice
 * before anyone noticed the cause was in it.
 *
 * WHAT IS DELIBERATELY DROPPED. The request body, in full. It is the thing that
 * made the log unreadable, it is reconstructible from the title being processed,
 * and on a shared instance it is the only field that could carry user content
 * into a log. Only the model id is lifted out of it, because "which model" is
 * the first question asked about a provider failure and the config may have
 * changed since.
 *
 * WHAT IS KEPT AND WHY. `status` separates the three faults that look identical
 * from the outside: 401/403 is a key, 429 is quota, 5xx is the provider having
 * a bad day and nothing to fix locally. `providerMessage` is the body, clipped
 * -- OpenRouter's own text ("Provider returned error") describes the proxy, not
 * the upstream failure, and the body is where the real reason lives.
 * `isRetryable` records what the SDK decided, which explains whether the
 * built-in backoff had already been spent before the throw reached us.
 */
import { APICallError, RetryError } from 'ai'

/** Longest provider message kept. Enough for a real explanation, not a payload. */
const MAX_PROVIDER_MESSAGE = 400

export interface AiErrorDescription {
  /**
   * Did this failure come from the model provider at all?
   *
   * The discriminator callers need, and not the same question as `status`: a
   * DNS failure or a dropped connection talking to the provider is a provider
   * failure with no status. Anything reporting a cause to a user has to get
   * this right -- the title-analysis route told an operator their search quota
   * was exhausted when the real fault was a model endpoint returning 404, in a
   * retrieval mode that has no search quota to exhaust.
   */
  isProviderError: boolean
  /** HTTP status, when the SDK saw one. Absent means the request never landed. */
  status?: number
  /** Whether the SDK judged this worth retrying, so exhausted backoff is visible. */
  isRetryable?: boolean
  /** The model actually asked for, lifted out of the request body. */
  model?: string
  /** Provider endpoint. Short, and says which service failed. */
  url?: string
  /** The provider's own words, clipped. Usually the only specific field. */
  providerMessage?: string
  /** The Error's message, always present so a non-API failure still says something. */
  message: string
}

/**
 * Flatten an error's cause / retry chain.
 *
 * Bounded because a chain can be cyclic, and `RetryError` is unwrapped
 * explicitly: the SDK's backoff wraps the real failure in a RetryError whose
 * own message says only that retries were exhausted, so reading the top of the
 * chain would lose the status every time retries were involved. Mirrors
 * `errorChain` in the assistant's error helper -- kept separate rather than
 * shared because core must not import from apps/api.
 */
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

/** Collapse whitespace and clip, so one field cannot swallow the log line. */
function clipMessage(value: string, limit: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}...` : flat
}

/**
 * Read the model id out of an APICallError's request body.
 *
 * `requestBodyValues` is typed `unknown` and its shape is the provider's, not
 * ours, so this is a guarded read rather than a cast -- a provider that names
 * the field differently loses the model id, which is the correct failure for
 * something that exists only to make a log line more useful.
 */
function modelOf(error: APICallError): string | undefined {
  const body = error.requestBodyValues
  if (typeof body !== 'object' || body === null) return undefined
  const model = (body as { model?: unknown }).model
  return typeof model === 'string' ? model : undefined
}

/**
 * Describe a failed AI call in fields worth logging.
 *
 * Safe on anything: a plain Error, a string, a rejected non-error. The point is
 * that a call site can log this unconditionally without first asking what kind
 * of failure it has.
 */
export function describeAiError(err: unknown): AiErrorDescription {
  const chain = errorChain(err)
  const firstError = chain.find((e): e is Error => e instanceof Error)
  const description: AiErrorDescription = {
    isProviderError: false,
    message: clipMessage(
      firstError?.message ?? (typeof err === 'string' ? err : String(err)),
      MAX_PROVIDER_MESSAGE
    ),
  }

  const apiError = chain.find((e): e is APICallError => APICallError.isInstance(e))
  if (!apiError) return description
  description.isProviderError = true

  if (typeof apiError.statusCode === 'number') description.status = apiError.statusCode
  if (typeof apiError.isRetryable === 'boolean') description.isRetryable = apiError.isRetryable
  if (apiError.url) description.url = apiError.url

  const model = modelOf(apiError)
  if (model) description.model = model

  // The body is where the upstream reason lives; the SDK's own message is
  // often just the proxy's summary of it. Kept only when it adds something the
  // message does not already say, so the common case stays one short line.
  const body = apiError.responseBody
  if (typeof body === 'string' && body.trim()) {
    const clipped = clipMessage(body, MAX_PROVIDER_MESSAGE)
    if (clipped && clipped !== description.message) description.providerMessage = clipped
  }

  return description
}
