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
import type { ParagraphMap } from '../analysis/paragraphMap.js'
import { createChildLogger } from '../lib/logger.js'
import type { AppLocaleCode } from '../lib/locales.js'
import {
  DEFAULT_TRANSLATION_CONFIG,
  INDEX_TRANSLATE_USER_AGENT,
  RATE_LIMIT_MAX_RETRIES,
  buildChatCompletionBody,
  chatCompletionsUrl,
  createStreamReader,
  enabledFields,
  joinTranslatedChunks,
  judgeTranslation,
  modelsUrl,
  rateLimitWaitMs,
  readCompletion,
  readErrorBody,
  readModelList,
  sanitizeTranslationConfig,
  splitForTranslation,
  type TextChunk,
  type TranslationConfig,
  type TranslationKind,
} from './rules.js'
import {
  analysisFitsOneRequest,
  analysisParagraphs,
  analysisTranslationGroups,
  joinAnalysisParagraphs,
} from './analysisText.js'

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
  targets: readonly AppLocaleCode[],
  kind: TranslationKind = 'synopsis'
): TranslationReadiness {
  // Each kind has its own switch; the endpoint and languages are shared.
  if (!(kind === 'analysis' ? config.analysisEnabled : config.enabled)) return { ready: false, reason: null }
  if (!chatCompletionsUrl(config.baseUrl)) {
    return { ready: false, reason: 'The endpoint needs a base URL starting with http:// or https://' }
  }
  if (!config.model.trim()) return { ready: false, reason: 'No model is set.' }
  if (kind === 'synopsis' && enabledFields(config).length === 0) {
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
    Accept: 'text/event-stream, application/json',
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
  /**
   * Which kind of text this is and that kind's instruction. Omitted, it is a
   * synopsis with `config.instruction` — the only kind there was before
   * analyses.
   */
  prompt?: TranslationPrompt
  /** Told when an analysis falls back from one request to section by section. */
  onNote?: (message: string) => void
}

export type TranslationPrompt = { kind: TranslationKind; instruction: string }

/** A text abandoned between chunks because the run was stopped. */
export class TranslationCancelledError extends Error {
  constructor() {
    super('Translation stopped between chunks')
    this.name = 'TranslationCancelledError'
  }
}

/**
 * Translate one text, streamed. A text longer than {@link TRANSLATION_CHUNK_CHARS}
 * is translated in pieces and joined; anything shorter is one request, so the
 * model sees all of it (see that constant for why streaming made that
 * possible). Throws {@link TranslationError} for anything
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
      return await requestTranslation(config, url, text, target, options.prompt)
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

export interface AnalysisTranslationResult extends TranslationResult {
  /** Paragraphs in the translation — always the source's count. */
  paragraphs: number
  /** One request for the whole analysis, or the section-by-section fallback. */
  strategy: 'whole' | 'sections'
}

/**
 * Translate a film analysis so that its paragraphs come back ONE FOR ONE,
 * which is what lets the stored paragraph index put the same section headings
 * over the translation (see ./analysisText.ts for why, and what was measured).
 *
 * 1. The whole analysis as one request, when it fits — full context.
 * 2. If it does not fit, or came back with a different paragraph count: each
 *    section (packed up to the size limit) as its own request.
 * 3. A section that still miscounts: each of its paragraphs alone. A single
 *    paragraph the model split in two is joined back into one.
 *
 * Every request goes through {@link translateText}, so pacing, Stop, 429
 * retries and every check on an answer apply to each of them, and any failure
 * throws — nothing of a half-translated analysis is returned.
 */
export async function translateAnalysisText(
  config: TranslationConfig,
  text: string,
  map: ParagraphMap | null,
  target: AppLocaleCode,
  options: TranslateOptions = {}
): Promise<AnalysisTranslationResult> {
  const opts: TranslateOptions = {
    ...options,
    prompt: options.prompt ?? { kind: 'analysis', instruction: config.analysisInstruction },
  }
  const source = analysisParagraphs(text)
  if (source.length === 0) throw new TranslationError('There is no text to translate')

  let model = config.model
  let latencyMs = 0
  const call = async (piece: string): Promise<string[]> => {
    const result = await translateText(config, piece, target, opts)
    model = result.model
    latencyMs += result.latencyMs
    return analysisParagraphs(result.text)
  }

  if (analysisFitsOneRequest(source)) {
    const whole = await call(joinAnalysisParagraphs(source))
    if (whole.length === source.length) {
      return { text: joinAnalysisParagraphs(whole), model, latencyMs, paragraphs: whole.length, strategy: 'whole' }
    }
    options.onNote?.(
      `came back as ${whole.length} paragraph(s) for ${source.length}; translating it section by section`
    )
  }

  const out: string[] = new Array(source.length)
  for (const group of analysisTranslationGroups(source, map)) {
    let pieces = await call(joinAnalysisParagraphs(group.map((i) => source[i])))
    if (pieces.length !== group.length) {
      if (group.length === 1) {
        pieces = [pieces.join(' ')]
      } else {
        pieces = []
        for (const i of group) pieces.push((await call(source[i])).join(' '))
      }
    }
    group.forEach((index, k) => {
      out[index] = pieces[k]
    })
  }
  return { text: joinAnalysisParagraphs(out), model, latencyMs, paragraphs: out.length, strategy: 'sections' }
}

/** One request: one piece of text, one answer. */
async function requestTranslation(
  config: TranslationConfig,
  url: string,
  text: string,
  target: AppLocaleCode,
  prompt: TranslationPrompt | undefined
): Promise<TranslationResult> {
  const body = buildChatCompletionBody(config, text, target, config.sourceLanguage, prompt)
  const startedAt = Date.now()
  const timedOut = (err: unknown) =>
    err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
  const noAnswer = `No answer within ${Math.round(config.timeoutMs / 1000)}s`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headersFor(config),
      body: JSON.stringify(body),
      // Covers the whole streamed body, not just the headers.
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (err) {
    throw new TranslationError(
      timedOut(err)
        ? noAnswer
        : `Could not reach the translation endpoint: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!response.ok) {
    const { message, rateLimit } = await readError(response)
    throw new TranslationError(`HTTP ${response.status}: ${message}`, response.status, rateLimit)
  }

  // A server that ignores `stream: true` answers with one JSON body; read that
  // the way every request was read before streaming.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    let json: unknown
    try {
      json = await response.json()
    } catch (err) {
      if (timedOut(err)) throw new TranslationError(noAnswer)
      throw new TranslationError(
        `The endpoint answered with a body that is not JSON: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    const reading = readCompletion(json, text, target)
    if (!reading.ok) throw new TranslationError(reading.reason)
    const answered = (json as { model?: unknown }).model
    return {
      text: reading.text,
      model: typeof answered === 'string' && answered ? answered : config.model,
      latencyMs: Date.now() - startedAt,
    }
  }

  const stream = createStreamReader()
  try {
    if (!response.body) throw new TranslationError('The endpoint sent a stream with no body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      stream.push(decoder.decode(value, { stream: true }))
    }
    stream.push(decoder.decode())
  } catch (err) {
    if (err instanceof TranslationError) throw err
    // A stream cut off part-way is not a translation; nothing of it is kept.
    throw new TranslationError(
      timedOut(err)
        ? `${noAnswer} (the translation was still arriving)`
        : `The stream broke off: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const streamed = stream.finish()
  if (streamed.error) throw new TranslationError(streamed.error)
  if (!streamed.sawData) throw new TranslationError('The endpoint sent an empty stream')
  // A stream that simply ENDS with no finish_reason was cut off by something
  // between us and the model; judged as `length` so it is never stored.
  const reading = judgeTranslation(streamed.content, streamed.finishReason ?? 'length', text, target)
  if (!reading.ok) throw new TranslationError(reading.reason)
  return {
    text: reading.text,
    model: streamed.model || config.model,
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
