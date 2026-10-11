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
import { startStreamStallGuard } from '../lib/streamStall.js'
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

export interface TranslationErrorDetails {
  /** On a 429: what the endpoint asked for, read into a wait per attempt by `rateLimitWaitMs`. */
  rateLimit?: { retryAfterSeconds: number | null; header: string | null }
  /**
   * A failure a SMALLER request could avoid: the answer was cut off at the
   * output limit, came back too short to be all of it, went silent past the
   * stall window, ran into the absolute deadline, or ended without the model
   * saying it was finished. `translateAnalysisText` falls back to smaller
   * requests on exactly these.
   */
  sizeRelated?: boolean
}

export class TranslationError extends Error {
  status?: number
  rateLimit?: TranslationErrorDetails['rateLimit']
  sizeRelated: boolean
  constructor(message: string, status?: number, details: TranslationErrorDetails = {}) {
    super(message)
    this.name = 'TranslationError'
    this.status = status
    this.rateLimit = details.rateLimit
    this.sizeRelated = details.sizeRelated === true
  }
}

/** A failure that a smaller request could avoid (see {@link TranslationErrorDetails}). */
export function isSizeRelatedFailure(err: unknown): boolean {
  return err instanceof TranslationError && err.sizeRelated
}

/** The provider's own words, and on a 429 the wait it asked for. */
async function readError(
  response: Response
): Promise<{ message: string; rateLimit?: TranslationErrorDetails['rateLimit'] }> {
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

/**
 * Wait, unless the run is stopped first. Polled once a second, so Stop reaches
 * a job sitting out a rate limit (up to a minute) rather than only the next
 * request after it. Returns true when stopped.
 */
async function waitUnlessCancelled(
  ms: number,
  shouldCancel: (() => Promise<boolean> | boolean) | undefined
): Promise<boolean> {
  const until = Date.now() + ms
  for (;;) {
    if (shouldCancel && (await shouldCancel()) === true) return true
    const left = until - Date.now()
    if (left <= 0) return false
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, left)))
  }
}

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
  /**
   * Polled WHILE a request streams and while a rate limit is waited out, so
   * Stop reaches a call already in flight (F-131) rather than only the next
   * one. True stops it with {@link TranslationCancelledError}.
   */
  shouldCancel?: () => Promise<boolean> | boolean
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
  /** Told when an analysis falls back from one request to smaller ones. */
  onNote?: (message: string) => void
}

export type TranslationPrompt = { kind: TranslationKind; instruction: string }

/** A text abandoned because the run was stopped — before, between or during requests. */
export class TranslationCancelledError extends Error {
  constructor() {
    super('Translation stopped')
    this.name = 'TranslationCancelledError'
  }
}

/**
 * The absolute ceiling on one request, however lively its stream — a backstop
 * against a server dribbling a token a minute, never the instrument that ends
 * a normal call. The operator's timeout is a SILENCE window
 * (`TranslationConfig.timeoutMs`); this only has to sit far above any real
 * translation. Measured: a full analysis is ~20s into Greek on the public
 * endpoint, and a 6,000-character request on a slow local model (~10 tok/s)
 * is a few minutes.
 */
export const TRANSLATION_DEADLINE_MS = 30 * 60 * 1000

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
      // Say which piece failed, or a long synopsis reads as failing whole. The
      // size flag travels with it, or a caller could not tell a cut-off piece
      // from any other failure.
      if (err instanceof TranslationError && chunks.length > 1) {
        throw new TranslationError(`Part ${index + 1} of ${chunks.length}: ${err.message}`, err.status, {
          sizeRelated: err.sizeRelated,
        })
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
 * (`rateLimitWaitMs`); Stop is polled during it, and `beforeCall` runs again
 * after it before the retry is sent.
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
      return await requestTranslation(config, url, text, target, options)
    } catch (err) {
      const limited = err instanceof TranslationError ? err.rateLimit : undefined
      if (!limited || attempt >= (options.rateLimitRetries ?? RATE_LIMIT_MAX_RETRIES)) throw err
      const waitMs = rateLimitWaitMs(limited.retryAfterSeconds, limited.header, attempt + 1)
      logger.info({ waitMs, attempt: attempt + 1 }, 'Translation endpoint rate-limited; waiting before retrying')
      options.onRateLimited?.(waitMs, attempt + 1)
      if (await waitUnlessCancelled(waitMs, options.shouldCancel)) throw new TranslationCancelledError()
    }
  }
}

export interface AnalysisTranslationResult extends TranslationResult {
  /** Paragraphs in the translation — always the source's count. */
  paragraphs: number
  /** One request for the whole analysis, or the smaller-requests fallback. */
  strategy: 'whole' | 'sections'
}

/**
 * Translate a film analysis so that its paragraphs come back ONE FOR ONE,
 * which is what lets the stored paragraph index put the same section headings
 * over the translation (see ./analysisText.ts for why, and what was measured).
 *
 * 1. The whole analysis as one request, when it fits — full context.
 * 2. Smaller requests when it does not fit, came back with a different
 *    paragraph count, or failed in a way a smaller request avoids (cut off,
 *    too short, gone silent — {@link isSizeRelatedFailure}): each section,
 *    packed up to the size limit.
 * 3. A section that still miscounts, or fails for its size: each of its
 *    paragraphs alone. A single paragraph the model split in two is joined
 *    back into one.
 *
 * NEVER THE SAME REQUEST TWICE. Decoding is greedy (temperature 0), so a
 * request repeated verbatim is answered verbatim — same miscount, same cut-off
 * — and costs a request for nothing. An analysis with no section structure
 * (no paragraph index, or one section) would otherwise make "section by
 * section" one group holding the whole text, the request that just failed; it
 * is halved instead.
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
  const whole = joinAnalysisParagraphs(source)

  let model = config.model
  let latencyMs = 0
  const call = async (piece: string): Promise<string[]> => {
    const result = await translateText(config, piece, target, opts)
    model = result.model
    latencyMs += result.latencyMs
    return analysisParagraphs(result.text)
  }

  let wholeFailure: unknown = null
  const triedWhole = analysisFitsOneRequest(source)
  if (triedWhole) {
    try {
      const back = await call(whole)
      // One paragraph in: whatever came back IS that paragraph.
      if (source.length === 1) {
        return { text: back.join(' '), model, latencyMs, paragraphs: 1, strategy: 'whole' }
      }
      if (back.length === source.length) {
        return { text: joinAnalysisParagraphs(back), model, latencyMs, paragraphs: back.length, strategy: 'whole' }
      }
      options.onNote?.(
        `came back as ${back.length} paragraph(s) for ${source.length}; translating it in smaller requests`
      )
    } catch (err) {
      if (!isSizeRelatedFailure(err)) throw err
      wholeFailure = err
      options.onNote?.(
        `${err instanceof Error ? err.message : String(err)}; translating it in smaller requests`
      )
    }
  }

  let groups = analysisTranslationGroups(source, map)
  if (triedWhole && groups.length === 1) {
    // The only "section" is the request that just failed (see above).
    groups = analysisTranslationGroups(source, map, Math.ceil(whole.length / 2))
    // A single paragraph has nothing smaller that keeps it one paragraph.
    if (groups.length === 1) throw wholeFailure ?? new TranslationError('The analysis could not be split further')
  }

  const out: string[] = new Array(source.length)
  for (const group of groups) {
    let pieces: string[] | null = null
    try {
      pieces = await call(joinAnalysisParagraphs(group.map((i) => source[i])))
    } catch (err) {
      if (group.length === 1 || !isSizeRelatedFailure(err)) throw err
    }
    if (pieces && pieces.length !== group.length && group.length === 1) pieces = [pieces.join(' ')]
    if (!pieces || pieces.length !== group.length) {
      pieces = []
      for (const i of group) pieces.push((await call(source[i])).join(' '))
    }
    group.forEach((index, k) => {
      out[index] = (pieces as string[])[k]
    })
  }
  return { text: joinAnalysisParagraphs(out), model, latencyMs, paragraphs: out.length, strategy: 'sections' }
}

/**
 * One request: one piece of text, one answer.
 *
 * ENDED BY SILENCE, NOT BY THE CLOCK (F-131). The operator's timeout is how
 * long the request may go without a byte — the wait for the first token, then
 * the gaps between them — so a slow local model writing steadily is never cut
 * off healthy, while a hung one still is. {@link TRANSLATION_DEADLINE_MS} is the
 * only absolute limit. The same guard polls Stop, which is what lets the job
 * be cancelled mid-request rather than only between requests. A reader blocked
 * on the socket is woken by the guard's own promise as well as by the abort,
 * because a caller left waiting on an aborted body is the hang F-131 measured.
 */
async function requestTranslation(
  config: TranslationConfig,
  url: string,
  text: string,
  target: AppLocaleCode,
  options: TranslateOptions
): Promise<TranslationResult> {
  const body = buildChatCompletionBody(config, text, target, config.sourceLanguage, options.prompt)
  const startedAt = Date.now()
  const guard = startStreamStallGuard({
    stallMs: config.timeoutMs,
    deadlineMs: TRANSLATION_DEADLINE_MS,
    // Checked often enough that a short window still means what it says.
    checkMs: Math.max(50, Math.min(1000, Math.floor(config.timeoutMs / 4))),
    shouldCancel: options.shouldCancel,
  })
  let arrived = false
  /** The error for a guard abort, phrased for what was happening when it fired. */
  const abortError = (): Error | null => {
    const reason = guard.reason()
    if (reason === 'cancelled') return new TranslationCancelledError()
    if (reason === 'stalled') {
      const seconds = Math.round(config.timeoutMs / 1000)
      return new TranslationError(
        arrived
          ? `The translation stopped arriving: nothing for ${seconds}s`
          : `No answer within ${seconds}s`,
        undefined,
        { sizeRelated: true }
      )
    }
    if (reason === 'deadline') {
      return new TranslationError(
        `The translation was still arriving after ${Math.round(TRANSLATION_DEADLINE_MS / 60_000)} minutes`,
        undefined,
        { sizeRelated: true }
      )
    }
    return null
  }
  // One promise that rejects when the guard aborts, raced by every step. Built
  // once rather than per step (a stream is a step per token), and given a
  // handler at once, so an abort landing between steps is not an unhandled
  // rejection.
  const aborted: Promise<never> = guard.aborted.then(() => {
    throw abortError() ?? new TranslationError('The request was aborted')
  })
  aborted.catch(() => {})
  /** Await a step of the request, but wake the moment the guard aborts. */
  const step = <T>(work: Promise<T>): Promise<T> => Promise.race([work, aborted])

  try {
    let response: Response
    try {
      response = await step(
        fetch(url, {
          method: 'POST',
          headers: headersFor(config),
          body: JSON.stringify(body),
          signal: guard.signal,
        })
      )
    } catch (err) {
      if (err instanceof TranslationError || err instanceof TranslationCancelledError) throw err
      throw (
        abortError() ??
        new TranslationError(
          `Could not reach the translation endpoint: ${err instanceof Error ? err.message : String(err)}`
        )
      )
    }

    if (!response.ok) {
      const { message, rateLimit } = await step(readError(response))
      // A gateway that gave up on a long wait (the public endpoint's own 504,
      // before streaming) is a size problem: a shorter request can finish.
      throw new TranslationError(`HTTP ${response.status}: ${message}`, response.status, {
        rateLimit,
        sizeRelated: response.status === 504 || response.status === 408,
      })
    }
    guard.activity()

    // A server that ignores `stream: true` answers with one JSON body; read that
    // the way every request was read before streaming.
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    if (!contentType.includes('text/event-stream')) {
      let json: unknown
      try {
        json = await step(response.json())
      } catch (err) {
        if (err instanceof TranslationError || err instanceof TranslationCancelledError) throw err
        throw (
          abortError() ??
          new TranslationError(
            `The endpoint answered with a body that is not JSON: ${err instanceof Error ? err.message : String(err)}`
          )
        )
      }
      const reading = readCompletion(json, text, target)
      if (!reading.ok) throw new TranslationError(reading.reason, undefined, { sizeRelated: reading.sizeRelated })
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
        const { done, value } = await step(reader.read())
        if (done) break
        guard.activity()
        arrived = true
        stream.push(decoder.decode(value, { stream: true }))
      }
      stream.push(decoder.decode())
    } catch (err) {
      if (err instanceof TranslationError || err instanceof TranslationCancelledError) throw err
      // A stream cut off part-way is not a translation; nothing of it is kept.
      throw (
        abortError() ??
        new TranslationError(`The stream broke off: ${err instanceof Error ? err.message : String(err)}`, undefined, {
          sizeRelated: true,
        })
      )
    }

    const streamed = stream.finish()
    if (streamed.error) throw new TranslationError(streamed.error)
    if (!streamed.sawData) throw new TranslationError('The endpoint sent an empty stream')
    // A stream that ENDS without a finish_reason was closed by something
    // between us and the model, or by a server that does not say; either way
    // nothing proves the answer is complete, so it is never stored — but it is
    // not a "cut off at the output limit", which would send an operator to the
    // wrong setting.
    if (streamed.finishReason == null) {
      throw new TranslationError(
        'The stream ended before the model said it was finished, so the translation may be incomplete',
        undefined,
        { sizeRelated: true }
      )
    }
    const reading = judgeTranslation(streamed.content, streamed.finishReason, text, target)
    if (!reading.ok) throw new TranslationError(reading.reason, undefined, { sizeRelated: reading.sizeRelated })
    return {
      text: reading.text,
      model: streamed.model || config.model,
      latencyMs: Date.now() - startedAt,
    }
  } finally {
    guard.stop()
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

/**
 * What the card's analysis Test translates: three short paragraphs of film
 * criticism, through `translateAnalysisText` with the analysis prompt and
 * instructions. Chosen to exercise exactly what an analysis translation can get
 * wrong — paragraphs that must come back one for one, a paragraph that OPENS on
 * "its" (the pronoun whose gender was measured going wrong when a paragraph is
 * translated without the one before it), and the names of a director, a film,
 * publications and a festival that must survive. The people and the film are
 * invented; Bergman and Winter Light are real, as a translator meets them.
 */
export const TRANSLATION_TEST_ANALYSIS_TEXT = [
  "Set almost entirely in a lighthouse keeper's cottage on the Norwegian coast, the film belongs to the " +
    'tradition of Scandinavian chamber drama that Ingmar Bergman made famous, and its director, Ingrid ' +
    'Halvorsen, has said she studied Winter Light frame by frame before shooting.',
  'Its most striking choice is to withhold the sea. We hear it in nearly every scene, yet the camera turns ' +
    'towards the water only once, in the final minute, so that a sound the viewer has learned to ignore ' +
    'becomes the whole of the ending.',
  'Critics were divided on release. The Guardian praised its patience, while Variety found the restraint ' +
    "closer to evasion; a retrospective at the Tromsø festival twenty years later did much to settle the " +
    "argument in the film's favour.",
].join('\n\n')
