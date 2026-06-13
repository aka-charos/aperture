/**
 * n8n chat pre-processing hook
 *
 * When enabled in Settings > Integrations, every chat request round-trips
 * through an n8n webhook before streaming starts. The workflow receives
 * { type: 'preProcess', userId, isAdmin, messages } and may respond with:
 * - messages: a replacement UIMessage[] (e.g. with injected web context)
 * - system: extra text appended to the system prompt
 *
 * Fails open: on timeout, error, or a malformed response the original
 * conversation proceeds untouched so a down n8n instance never breaks chat.
 */
import type { UIMessage } from 'ai'
import { getN8nConfig, callN8nWebhook, createChildLogger } from '@aperture/core'

const logger = createChildLogger('n8n-preprocess')

interface PreProcessResponse {
  messages?: unknown
  system?: unknown
}

function isValidUIMessages(value: unknown): value is UIMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (m) =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as UIMessage).role === 'string' &&
        Array.isArray((m as UIMessage).parts)
    )
  )
}

export async function applyN8nPreProcess(
  messages: UIMessage[],
  user: { id: unknown; isAdmin: boolean }
): Promise<{ messages: UIMessage[]; systemAppend: string | null }> {
  const { preProcess } = await getN8nConfig()
  if (!preProcess?.enabled || !preProcess.webhookUrl) {
    return { messages, systemAppend: null }
  }

  try {
    const result = await callN8nWebhook<PreProcessResponse>(
      preProcess,
      { type: 'preProcess', userId: user.id, isAdmin: user.isAdmin, messages },
      10000
    )

    const processedMessages = isValidUIMessages(result.messages) ? result.messages : messages
    const systemAppend =
      typeof result.system === 'string' && result.system.trim() ? result.system : null

    if (processedMessages !== messages || systemAppend) {
      logger.info(
        { replacedMessages: processedMessages !== messages, hasSystemAppend: !!systemAppend },
        'Applied n8n pre-processing to chat request'
      )
    }

    return { messages: processedMessages, systemAppend }
  } catch (error) {
    logger.warn({ error }, 'n8n pre-process webhook failed; continuing with original request')
    return { messages, systemAppend: null }
  }
}
