/**
 * Decision-model integration — an OPTIONAL second opinion for bounded yes/no
 * judgments. The rules (settings, URLs, answer parsing) are pure and live in
 * ./decisionModelRules.ts; this file stores the settings and makes the calls.
 *
 * NOTHING MAY DEPEND ON THIS. Every caller treats "off", "unconfigured",
 * "failed" and "timed out" identically: it falls back to whatever the app did
 * before the integration existed. The one consumer today is the evidence
 * heading (recommender/judgeEvidence.ts), where the fallback is the cosine bar.
 *
 * Config is one JSON blob in `system_settings`, like ./crw.ts and ./tavily.ts.
 * Calls through OpenRouter go through the metered fetch, so they appear on the
 * AI spend dashboard (F-119); a self-hosted server is free and is not metered.
 */
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { createChildLogger } from './logger.js'
import { createMeteredFetch } from './usageFetch.js'
import { resolveProviderEndpoint } from './ai-provider.js'
import {
  DEFAULT_DECISION_MODEL_CONFIG,
  OPENROUTER_DECISION_MODELS_URL,
  OPENROUTER_SYSTEMONE_URL,
  isRetryableDecisionFailure,
  modelsUrlFor,
  readSystemOneUsage,
  sanitizeDecisionModelConfig,
  systemOneUrl,
  type DecisionModelConfig,
  type SystemOneCall,
} from './decisionModelRules.js'

const logger = createChildLogger('decision-model')

const SETTING_KEY = 'decision_model_integration'

/** Ledger role for these calls. Not an AI function, so it reads as its own row. */
const LEDGER_ROLE = 'decisionModel'

export async function getDecisionModelConfig(): Promise<DecisionModelConfig> {
  const json = await getSystemSetting(SETTING_KEY)
  if (json) {
    try {
      return sanitizeDecisionModelConfig(JSON.parse(json) as Partial<DecisionModelConfig>)
    } catch (err) {
      logger.error({ err }, 'Failed to parse decision_model_integration config')
    }
  }
  return { ...DEFAULT_DECISION_MODEL_CONFIG }
}

export async function setDecisionModelConfig(config: DecisionModelConfig): Promise<void> {
  await setSystemSetting(
    SETTING_KEY,
    JSON.stringify(sanitizeDecisionModelConfig(config)),
    'Optional decision model (System One API) used to judge recommendation evidence'
  )
  logger.info('Decision model configuration updated')
}

export interface DecisionEndpoint {
  url: string
  apiKey?: string
  /** True when the call costs money and belongs on the spend dashboard. */
  metered: boolean
}

export type DecisionEndpointResolution =
  | { ok: true; endpoint: DecisionEndpoint }
  | { ok: false; reason: string }

/**
 * Where a call goes and with what credential, or why it cannot go anywhere.
 *
 * The OpenRouter key is the one the AI page already holds — there is no second
 * copy to drift — which is also why "no key" is a readiness answer rather than
 * a field on this card.
 */
export async function resolveDecisionEndpoint(
  config: DecisionModelConfig
): Promise<DecisionEndpointResolution> {
  if (config.source === 'openrouter') {
    const { apiKey } = await resolveProviderEndpoint('openrouter')
    if (!apiKey) {
      return {
        ok: false,
        reason:
          'No OpenRouter API key is configured. Add one to any AI role that uses OpenRouter, or point this at a self-hosted server.',
      }
    }
    return { ok: true, endpoint: { url: OPENROUTER_SYSTEMONE_URL, apiKey, metered: true } }
  }

  const url = systemOneUrl(config.baseUrl)
  if (!url) {
    return { ok: false, reason: 'A self-hosted server needs a base URL starting with http:// or https://' }
  }
  return {
    ok: true,
    endpoint: { url, apiKey: config.apiKey || undefined, metered: false },
  }
}

export interface DecisionModelReadiness {
  /** True when a run would actually ask the model. */
  ready: boolean
  /** Why not, in a sentence an operator can act on. Null when ready or simply off. */
  reason: string | null
}

export async function checkDecisionModelReadiness(
  config: DecisionModelConfig
): Promise<DecisionModelReadiness> {
  if (!config.enabled) return { ready: false, reason: null }
  if (!config.model.trim()) return { ready: false, reason: 'No model is selected.' }
  const resolved = await resolveDecisionEndpoint(config)
  return resolved.ok ? { ready: true, reason: null } : { ready: false, reason: resolved.reason }
}

export class DecisionModelError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'DecisionModelError'
    this.status = status
  }
}

export interface SystemOneAnswer {
  /** The model the endpoint says answered — may carry a date suffix. */
  model: string
  answers: Record<string, unknown>
  latencyMs: number
}

const meteredFetch = createMeteredFetch({
  provider: 'openrouter',
  role: LEDGER_ROLE,
  readChunk: readSystemOneUsage,
})

/** The provider's own words, when the body has any. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text()
    try {
      const json = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown }
      const error = json.error
      if (typeof error === 'string') return error
      if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
        return (error as { message: string }).message
      }
      if (typeof json.message === 'string') return json.message
      if (typeof json.detail === 'string') return json.detail
    } catch {
      // Not JSON: fall through to the raw text.
    }
    return text.slice(0, 300) || response.statusText
  } catch {
    return response.statusText
  }
}

async function sendOnce(
  endpoint: DecisionEndpoint,
  call: SystemOneCall,
  timeoutMs: number
): Promise<SystemOneAnswer> {
  const startedAt = Date.now()
  const doFetch = endpoint.metered ? meteredFetch : fetch
  let response: Response
  try {
    response = await doFetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
      },
      body: JSON.stringify(call),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new DecisionModelError(
      timedOut
        ? `No answer within ${Math.round(timeoutMs / 1000)}s`
        : `Could not reach the decision model: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!response.ok) {
    const message = await readErrorMessage(response)
    throw new DecisionModelError(`HTTP ${response.status}: ${message}`, response.status)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (err) {
    // The timeout covers the body as well as the headers, and a stall there
    // must not be reported as a malformed answer.
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new DecisionModelError(
      timedOut
        ? `No answer within ${Math.round(timeoutMs / 1000)}s`
        : 'The decision model returned a body that is not JSON'
    )
  }
  const body = (json ?? {}) as { model?: unknown; answers?: unknown }
  if (!body.answers || typeof body.answers !== 'object') {
    throw new DecisionModelError('The response carried no answers', response.status)
  }
  return {
    model: typeof body.model === 'string' && body.model ? body.model : call.model,
    answers: body.answers as Record<string, unknown>,
    latencyMs: Date.now() - startedAt,
  }
}

/** Retried once on a rate limit, overload or 5xx, after a short pause. */
const RETRY_DELAY_MS = 1_500

export async function callSystemOne(
  endpoint: DecisionEndpoint,
  call: SystemOneCall,
  timeoutMs: number
): Promise<SystemOneAnswer> {
  try {
    return await sendOnce(endpoint, call, timeoutMs)
  } catch (err) {
    if (err instanceof DecisionModelError && isRetryableDecisionFailure(err.status)) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      return sendOnce(endpoint, call, timeoutMs)
    }
    throw err
  }
}

export interface DecisionModelOption {
  id: string
  name: string | null
  contextLength: number | null
  /** USD per million input tokens; output is free on every listed model. */
  inputPricePerMillion: number | null
}

export interface DecisionModelCatalog {
  /** False when the server could not be asked — not the same as "lists nothing". */
  reachable: boolean
  models: DecisionModelOption[]
}

const CATALOG_TTL_MS = 10 * 60 * 1000
let openRouterCatalog: { fetchedAt: number; catalog: DecisionModelCatalog } | null = null

function parseCatalog(json: unknown): DecisionModelOption[] {
  const data = (json as { data?: unknown; models?: unknown })?.data ?? (json as { models?: unknown })?.models
  if (!Array.isArray(data)) return []
  const out: DecisionModelOption[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const id = typeof e.id === 'string' ? e.id : typeof e.name === 'string' ? e.name : null
    if (!id) continue
    const pricing = e.pricing as { prompt?: unknown } | undefined
    const prompt = pricing?.prompt != null ? Number(pricing.prompt) : NaN
    out.push({
      id,
      name: typeof e.name === 'string' && e.name !== id ? e.name : null,
      contextLength: typeof e.context_length === 'number' ? e.context_length : null,
      inputPricePerMillion: Number.isFinite(prompt) ? prompt * 1_000_000 : null,
    })
  }
  return out
}

/**
 * What the configured source offers.
 *
 * OpenRouter's list is public and cached for ten minutes. A self-hosted server
 * is asked at `<root>/v1/models` every time, because "Refresh" must not answer
 * from a cache (F-115 rule 6); a server that does not expose the list is
 * `reachable: false`, and the card falls back to a typed id.
 */
export async function listDecisionModels(config: DecisionModelConfig): Promise<DecisionModelCatalog> {
  if (config.source === 'openrouter') {
    const cached = openRouterCatalog
    if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.catalog
    try {
      const response = await fetch(OPENROUTER_DECISION_MODELS_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) return { reachable: false, models: [] }
      const catalog = { reachable: true, models: parseCatalog(await response.json()) }
      openRouterCatalog = { fetchedAt: Date.now(), catalog }
      return catalog
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch the OpenRouter decision-model catalog')
      return { reachable: false, models: [] }
    }
  }

  const url = modelsUrlFor(config.baseUrl)
  if (!url) return { reachable: false, models: [] }
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { reachable: false, models: [] }
    return { reachable: true, models: parseCatalog(await response.json()) }
  } catch {
    return { reachable: false, models: [] }
  }
}
