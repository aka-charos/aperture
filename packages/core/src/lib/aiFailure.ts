import { APICallError } from 'ai'
import { createChildLogger } from './logger.js'
import { parseApiError, logApiError, hasRecentSimilarError } from '../errors/index.js'
import type { ParsedApiError } from '../errors/types.js'

const logger = createChildLogger('ai-failure')

/**
 * api_errors only has error tables for these two AI providers. The OpenAI-shaped ones (groq,
 * deepseek, openrouter, openai-compatible) are deliberately NOT mapped onto 'openai' — an alert
 * reading "OpenAI" for a Groq outage sends the operator to the wrong dashboard.
 */
const SINK_PROVIDERS = new Set<ParsedApiError['provider']>(['openai', 'google'])

function isSinkProvider(provider: string | undefined): provider is ParsedApiError['provider'] {
  return !!provider && SINK_PROVIDERS.has(provider as ParsedApiError['provider'])
}

/**
 * Turn a failed AI call into a sentence worth showing the user, and record it to the api_errors
 * sink when the provider has definitions there.
 *
 * The point is that "Failed to generate name" tells nobody anything: an expired key, a daily
 * quota, and an overloaded model all need different responses from the operator. Never throws —
 * a broken error path must not replace the error being reported.
 */
export async function describeAiFailure(
  provider: string | undefined,
  error: unknown
): Promise<string> {
  if (!APICallError.isInstance(error)) {
    return error instanceof Error ? error.message : 'Unknown AI provider error'
  }

  const status = error.statusCode ?? 0
  const detail = (error.message || '').slice(0, 300)

  if (!isSinkProvider(provider)) {
    return status ? `The AI provider returned HTTP ${status}. ${detail}` : detail
  }

  const parsed = parseApiError(provider, status, { errorMessage: detail })

  try {
    if (!(await hasRecentSimilarError(provider, parsed.definition.type, status))) {
      await logApiError(parsed)
    }
  } catch (err) {
    logger.warn({ err, provider, status }, 'Failed to record AI error to api_errors')
  }

  return parsed.definition.action
    ? `${parsed.definition.message} ${parsed.definition.action}.`
    : parsed.definition.message
}
