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
  RATE_LIMIT_MAX_RETRIES,
  buildChatCompletionBody,
  chatCompletionsUrl,
  enabledFields,
  joinTranslatedChunks,
  modelsUrl,
  rateLimitWaitMs,
  readCompletion,
  readErrorBody,
  readModelList,
  sanitizeTranslationConfig,
  splitForTranslation,
  type TextChunk,
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
  /** On a 429: what the endpoint asked for, read into a wait per attempt by `rateLimitWaitMs`. */
  rateLimit?: { retryAfterSeconds: number | null; header: string | null }
  constructor(
    message: string,
    status?: number,
    rateLimit?: { retryAfterSeconds: number | null; header: string | null }
  ) {
    super(message)
    this.name = 'TranslationError'
    this.status = status
    this.rateLimit = rateLimit
  }
}

/** The provider's own words, and on a 429 the wait it asked for. */
async function readError(
  response: Response
): Promise<{ message: string; rateLimit?: { retryAfterSeconds: number | null; header: string | null } }> {
  let text = ''
  try {
    text = await response.text()
  } catch {
    // Body unreadable: the status line is all there is.
  }
  const { message, retryAfterSeconds } = readErrorBody(text)
  return {
    message: message ?? response.statusText,
    rateLimit:
      response.status === 429
        ? { retryAfterSeconds, header: response.headers.get('retry-after') }
        : undefined,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

export interface TranslateOptions {
  /**
   * Called before EVERY request, including each chunk of a long text — that is
   * where the job's pacing wait and cancellation live, so a synopsis cut into
   * five chunks is five paced calls rather than a burst. Return false to stop:
   * the call then throws {@link TranslationCancelledError} and nothing of the
   * text is returned, since half a synopsis must never be stored.
   */
  beforeCall?: () => Promise<boolean>
  /** Told when a 429 makes the call wait, so the job log can say why it paused. */
  onRateLimited?: (waitMs: number, attempt: number) => void
  /**
   * Retries after a 429 before it is reported. Defaults to
   * {@link RATE_LIMIT_MAX_RETRIES} (minutes of waiting, right for the job); an
   * interactive caller passes 0, since a request held open that long is cut
   * off by any proxy in front of it (F-141) and the 429 IS the answer there.
   */
  rateLimitRetries?: number
}

/** A text abandoned between chunks because the run was stopped. */
export class TranslationCancelledError extends Error {
  constructor() {
    super('Translation stopped between chunks')
    this.name = 'TranslationCancelledError'
  }
}

/**
 * Translate one text. A text longer than {@link TRANSLATION_CHUNK_CHARS} is
 * translated in pieces and joined (the public endpoint's gateway gives up on
 * any request over ten seconds). Throws {@link TranslationError} for anything
 * that is not a usable translation — transport, HTTP status, a truncated
 * answer, an echo of the source — in ANY chunk, so the caller stores nothing
 * and the pair stays pending.
 */
export async function translateText(
  config: TranslationConfig,
  text: string,
  target: AppLocaleCode,
  options: TranslateOptions = {}
): Promise<TranslationResult> {
  const url = chatCompletionsUrl(config.baseUrl)
  if (!url) throw new TranslationError('The endpoint base URL is not an http(s) URL')

  const chunks = splitForTranslation(text)
  // Blank text has nothing to translate; answering '' would store an empty
  // translation that reads as current. (The pending SQL never selects one.)
  if (chunks.length === 0) throw new TranslationError('There is no text to translate')
  const parts: Array<{ text: string; joinBefore: TextChunk['joinBefore'] }> = []
  let model = config.model
  let latencyMs = 0
  for (const [index, chunk] of chunks.entries()) {
    try {
      const piece = await requestWithRateLimitRetry(config, url, chunk.text, target, options)
      parts.push({ text: piece.text, joinBefore: chunk.joinBefore })
      model = piece.model
      latencyMs += piece.latencyMs
    } catch (err) {
      // Say which piece failed, or a long synopsis reads as failing whole.
      if (err instanceof TranslationError && chunks.length > 1) {
        throw new TranslationError(`Part ${index + 1} of ${chunks.length}: ${err.message}`, err.status)
      }
      throw err
    }
  }
  return { text: joinTranslatedChunks(parts, target), model, latencyMs }
}

/**
 * One piece, retried while the endpoint answers 429. A rate limit is a fact
 * about the last minute of traffic, not about this text, so failing the pair
 * on it would push a perfectly good title to the back of the queue and count
 * toward the "endpoint is down" stop. The wait is the larger of what the
 * endpoint asked for and a backoff that doubles per attempt
 * (`rateLimitWaitMs`), and `beforeCall` runs again after it, so a Stop pressed
 * during the wait is honoured before the retry is sent.
 */
async function requestWithRateLimitRetry(
  config: TranslationConfig,
  url: string,
  text: string,
  target: AppLocaleCode,
  options: TranslateOptions
): Promise<TranslationResult> {
  for (let attempt = 0; ; attempt++) {
    if (options.beforeCall && !(await options.beforeCall())) throw new TranslationCancelledError()
    try {
      return await requestTranslation(config, url, text, target)
    } catch (err) {
      const limited = err instanceof TranslationError ? err.rateLimit : undefined
      if (!limited || attempt >= (options.rateLimitRetries ?? RATE_LIMIT_MAX_RETRIES)) throw err
      const waitMs = rateLimitWaitMs(limited.retryAfterSeconds, limited.header, attempt + 1)
      logger.info({ waitMs, attempt: attempt + 1 }, 'Translation endpoint rate-limited; waiting before retrying')
      options.onRateLimited?.(waitMs, attempt + 1)
      await sleep(waitMs)
    }
  }
}

/** One request: one piece of text, one answer. */
async function requestTranslation(
  config: TranslationConfig,
  url: string,
  text: string,
  target: AppLocaleCode
): Promise<TranslationResult> {
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
    const { message, rateLimit } = await readError(response)
    throw new TranslationError(`HTTP ${response.status}: ${message}`, response.status, rateLimit)
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
