/**
 * n8n Webhook Integration
 *
 * Lets an external n8n instance participate in the AI assistant pipeline via
 * two independently configurable webhooks:
 *
 * - searchTool: exposed to the chat model as a `search_web` tool. Payload:
 *   { type: 'search', query, maxResults }. The workflow can run a web search,
 *   scrape pages, or call a grounded LLM — whatever JSON it responds with is
 *   returned to the model as the tool result.
 *
 * - preProcess: called before each chat completion with the full conversation.
 *   Payload: { type: 'preProcess', userId, isAdmin, messages }. The workflow
 *   may respond with { messages?: UIMessage[], system?: string } to replace
 *   the conversation and/or append system-prompt context. Failures fail open
 *   (the original request proceeds untouched).
 */
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { createChildLogger } from './logger.js'

const logger = createChildLogger('n8n')

export interface N8nWebhookConfig {
  enabled: boolean
  webhookUrl: string
  /** Optional custom auth header sent with every call (e.g. 'X-N8N-Auth') */
  authHeaderName?: string
  authHeaderValue?: string
  /** Request timeout in ms; callers provide a sensible default per webhook */
  timeoutMs?: number
}

export interface N8nIntegrationConfig {
  searchTool: N8nWebhookConfig | null
  preProcess: N8nWebhookConfig | null
}

const SETTING_KEY = 'n8n_integration'

export async function getN8nConfig(): Promise<N8nIntegrationConfig> {
  const json = await getSystemSetting(SETTING_KEY)
  if (json) {
    try {
      return JSON.parse(json) as N8nIntegrationConfig
    } catch (e) {
      logger.error({ error: e }, 'Failed to parse n8n_integration config')
    }
  }
  return { searchTool: null, preProcess: null }
}

export async function setN8nConfig(config: N8nIntegrationConfig): Promise<void> {
  await setSystemSetting(
    SETTING_KEY,
    JSON.stringify(config),
    'n8n webhook integration for the AI assistant (search tool + pre-processing)'
  )
  logger.info('n8n integration configuration updated')
}

export class N8nWebhookError extends Error {}

/**
 * POST a JSON payload to an n8n webhook and return the parsed JSON response.
 * Plain-text responses are wrapped as { text }; empty bodies (n8n "respond
 * immediately" mode) become {}.
 */
export async function callN8nWebhook<T = unknown>(
  webhook: N8nWebhookConfig,
  payload: unknown,
  defaultTimeoutMs = 15000
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (webhook.authHeaderName && webhook.authHeaderValue) {
    headers[webhook.authHeaderName] = webhook.authHeaderValue
  }

  const response = await fetch(webhook.webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(webhook.timeoutMs ?? defaultTimeoutMs),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new N8nWebhookError(`n8n webhook returned ${response.status}: ${body.slice(0, 300)}`)
  }

  const text = await response.text()
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    return { text } as T
  }
}
