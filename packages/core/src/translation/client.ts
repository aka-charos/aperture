/**
 * Synopsis translation: settings storage and the one HTTP call.
 *
 * Config is one JSON blob in `system_settings`, like the decision model and
 * fastCRW. The endpoint is any OpenAI-compatible `/chat/completions`; the
 * default is bilibili's free public Index-Translate API. Calls are not metered
 * on the spend dashboard (F-119): the default endpoint is free, and a metered
 * provider needs a writer and a pricer this PoC does not have — see the rule in
 * CLAUDE.md before pointing it at a paid endpoint.
 */
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { createChildLogger } from '../lib/logger.js'
import type { AppLocaleCode } from '../lib/locales.js'
import {
  DEFAULT_TRANSLATION_CONFIG,
  INDEX_TRANSLATE_USER_AGENT,
  buildChatCompletionBody,
  chatCompletionsUrl,
  enabledFields,
  modelsUrl,
  readCompletion,
  readModelList,
  sanitizeTranslationConfig,
  type TranslationConfig,
} from './rules.js'

const logger = createChildLogger('translation')

const SETTING_KEY = 'translation_integration'

export async function getTranslationConfig(): Promise<TranslationConfig> {
  const json = await getSystemSetting(SETTING_KEY)
  if (json) {
    try {
      return sanitizeTranslationConfig(JSON.parse(json) as Partial<TranslationConfig>)
    } catch (err) {
      logger.error({ err }, 'Failed to parse translation_integration config')
    }
  }
  return sanitizeTranslationConfig(DEFAULT_TRANSLATION_CONFIG)
}

export async function setTranslationConfig(config: TranslationConfig): Promise<void> {
  await setSystemSetting(
    SETTING_KEY,
    JSON.stringify(sanitizeTranslationConfig(config)),
    'Synopsis translation: OpenAI-compatible endpoint, model and target languages'
  )
  logger.info('Translation configuration updated')
}

export interface TranslationReadiness {
  /** True when a run would actually translate something. */
  ready: boolean
  /** Why not, in a sentence an operator can act on. Null when ready or simply off. */
  reason: string | null
}

/**
 * Whether a run can do anything. `targets` is the resolved list
 * (`resolveTargetLanguages`), passed in so the card and the job resolve it
 * once and agree.
 */
export function checkTranslationReadiness(
  config: TranslationConfig,
  targets: readonly AppLocaleCode[]
): TranslationReadiness {
  if (!config.enabled) return { ready: false, reason: null }
  if (!chatCompletionsUrl(config.baseUrl)) {
    return { ready: false, reason: 'The endpoint needs a base URL starting with http:// or https://' }
  }
  if (!config.model.trim()) return { ready: false, reason: 'No model is set.' }
  if (enabledFields(config).length === 0) {
    return { ready: false, reason: 'Neither the plot nor the full synopsis is switched on.' }
  }
  if (targets.length === 0) {
    return {
      ready: false,
      reason:
        'There is no language to translate into. Enable a second interface language under Appearance → Language defaults, or tick one on the Synopsis translation card.',
    }
  }
  return { ready: true, reason: null }
}

export class TranslationError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'TranslationError'
    this.status = status
  }
}

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

function headersFor(config: TranslationConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(config.promptStyle === 'index-translate' ? { 'User-Agent': INDEX_TRANSLATE_USER_AGENT } : {}),
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  }
}

export interface TranslationResult {
  text: string
  /** What the endpoint says answered, falling back to what was asked for. */
  model: string
  latencyMs: number
}

/**
 * Translate one text. Throws {@link TranslationError} for anything that is not
 * a usable translation — transport, HTTP status, a truncated answer, an echo of
 * the source — so the caller stores nothing and the pair stays pending.
 */
export async function translateText(
  config: TranslationConfig,
  text: string,
  target: AppLocaleCode
): Promise<TranslationResult> {
  const url = chatCompletionsUrl(config.baseUrl)
  if (!url) throw new TranslationError('The endpoint base URL is not an http(s) URL')

  const body = buildChatCompletionBody(config, text, target, config.sourceLanguage)
  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headersFor(config),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new TranslationError(
      timedOut
        ? `No answer within ${Math.round(config.timeoutMs / 1000)}s`
        : `Could not reach the translation endpoint: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!response.ok) {
    throw new TranslationError(`HTTP ${response.status}: ${await readErrorMessage(response)}`, response.status)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (err) {
    // The timeout covers the body as well as the headers.
    throw new TranslationError(
      `The endpoint answered with a body that is not JSON: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const reading = readCompletion(json, text)
  if (!reading.ok) throw new TranslationError(reading.reason)

  const answered = (json as { model?: unknown }).model
  return {
    text: reading.text,
    model: typeof answered === 'string' && answered ? answered : config.model,
    latencyMs: Date.now() - startedAt,
  }
}

/**
 * What the endpoint lists at `/models`, or `reachable: false`. Several servers
 * (the public Index-Translate API among them, if it follows its own proxy)
 * answer this; one that does not is still usable with a typed model id, so
 * failing here is information for the card, never an error.
 */
export async function listTranslationModels(
  config: Pick<TranslationConfig, 'baseUrl' | 'apiKey' | 'promptStyle'>
): Promise<{ reachable: boolean; models: string[] }> {
  const url = modelsUrl(config.baseUrl)
  if (!url) return { reachable: false, models: [] }
  try {
    const response = await fetch(url, {
      headers: headersFor({ ...DEFAULT_TRANSLATION_CONFIG, ...config }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { reachable: false, models: [] }
    return { reachable: true, models: readModelList(await response.json()) }
  } catch {
    return { reachable: false, models: [] }
  }
}

/**
 * The sentence the card's Test button translates. A real synopsis-shaped
 * paragraph with a name and a title in it, because "Hello" passes on a model
 * that mangles names, and names are what synopses are made of.
 */
export const TRANSLATION_TEST_TEXT =
  'After a botched heist in Marseille, a retired safecracker named Viktor Hale is forced to take one last job — ' +
  'and to work alongside the detective who put him away twenty years ago.'
