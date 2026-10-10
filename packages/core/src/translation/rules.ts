/**
 * The pure half of synopsis translation: its settings, the prompt, the request
 * body and how an answer is read. No runtime imports beyond the locale table,
 * so every rule here is pinned by `rules.test.ts` without a database or a key.
 *
 * WHY AN INTEGRATION AND NOT AN AI ROLE. Same argument as the decision model
 * (lib/decisionModelRules.ts): one consumer, optional, and a contract of its
 * own. The model it ships for — bilibili's Index-Translate — is a dedicated
 * translation model served at an OpenAI-compatible endpoint, but it is
 * prompted with a fixed Chinese instruction and wants reasoning switched off
 * through `chat_template_kwargs`, neither of which the AI SDK roles would send.
 * A role would also cost ten schema enums (F-002) for something nothing else
 * depends on.
 *
 * TWO PROMPT STYLES, ONE ENDPOINT SHAPE. `index-translate` reproduces
 * `inference/llm/call_api.py`'s `build_prompt` byte for byte, because that is
 * the prompt the model was trained and benchmarked on; `instruction` is a plain
 * system prompt for any other chat model behind an OpenAI-compatible URL
 * (LM Studio, vLLM, OpenRouter, a local Qwen). Both go to
 * `<baseUrl>/chat/completions`.
 */
import {
  APP_LOCALE_OPTIONS,
  DEFAULT_LOCALE,
  isValidAppLocale,
  type AppLocaleCode,
} from '../lib/locales.js'

export const TRANSLATION_PROMPT_STYLES = ['index-translate', 'instruction'] as const
export type TranslationPromptStyle = (typeof TRANSLATION_PROMPT_STYLES)[number]

export function isTranslationPromptStyle(value: unknown): value is TranslationPromptStyle {
  return (
    typeof value === 'string' && (TRANSLATION_PROMPT_STYLES as readonly string[]).includes(value)
  )
}

/** The fields a translation can be made of. A column name, not a label. */
export const TRANSLATABLE_FIELDS = ['overview', 'plot_full'] as const
export type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number]

export function isTranslatableField(value: unknown): value is TranslatableField {
  return typeof value === 'string' && (TRANSLATABLE_FIELDS as readonly string[]).includes(value)
}

/** The free public Index-Translate endpoint (OpenAI-compatible). */
export const INDEX_TRANSLATE_BASE_URL = 'https://index-translate.bilibili.com/v1'
export const INDEX_TRANSLATE_DEFAULT_MODEL = 'Index-Translate-35B-A3B'
/**
 * The official client sends this, and the README says browser extensions need
 * the bundled proxy because of the endpoint's "CORS/WAF headers" — so the
 * header is sent for the Index-Translate style rather than guessed about.
 */
export const INDEX_TRANSLATE_USER_AGENT = 'Index-Translate-Client/1.0'

export interface TranslationConfig {
  /** Off by default; gates the job only. Stored translations are always read. */
  enabled: boolean
  promptStyle: TranslationPromptStyle
  /** OpenAI-compatible root, `<root>` or `<root>/v1`; see {@link chatCompletionsUrl}. */
  baseUrl: string
  model: string
  /** Optional bearer. The free endpoint needs none. */
  apiKey: string
  /** What the stored metadata is written in. Almost always English. */
  sourceLanguage: AppLocaleCode
  /**
   * Which enabled UI languages to translate into. NULL follows the enabled UI
   * languages (minus the source) as they change; a list narrows them. A
   * language not enabled for the interface is never a target, whatever is
   * stored here — nobody could be shown it.
   */
  targetLanguages: AppLocaleCode[] | null
  /** Which columns to translate. */
  fields: Record<TranslatableField, boolean>
  /**
   * Optional constraint, e.g. "keep character names in Latin script". Sent as
   * an instTrans 【注意】 constraint for Index-Translate, appended to the system
   * prompt otherwise. Empty sends the plain prompt.
   */
  instruction: string
  /** Per request. A long synopsis is a few thousand output tokens. */
  timeoutMs: number
  /** Gap between calls to one endpoint; the public one is a free service. */
  callSpacingSeconds: number
}

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  enabled: false,
  promptStyle: 'index-translate',
  baseUrl: INDEX_TRANSLATE_BASE_URL,
  model: INDEX_TRANSLATE_DEFAULT_MODEL,
  apiKey: '',
  sourceLanguage: DEFAULT_LOCALE,
  targetLanguages: null,
  fields: { overview: true, plot_full: true },
  instruction: '',
  timeoutMs: 120_000,
  callSpacingSeconds: 1,
}

export const TRANSLATION_TIMEOUT_MIN_MS = 5_000
export const TRANSLATION_TIMEOUT_MAX_MS = 600_000
export const TRANSLATION_SPACING_MAX_SECONDS = 120
export const TRANSLATION_INSTRUCTION_MAX_CHARS = 500

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function sanitizeLanguageList(raw: unknown): AppLocaleCode[] | null {
  if (raw == null) return null
  if (!Array.isArray(raw)) return null
  const seen = new Set<AppLocaleCode>()
  for (const code of raw) {
    if (isValidAppLocale(code)) seen.add(code)
  }
  return [...seen]
}

/**
 * A stored blob, made whole. Absent fields take their defaults and absence is
 * checked BEFORE coercion — `Number(null)` is 0 and finite, so a missing knob
 * would otherwise clamp to its minimum (the discovery-config lesson, F-104).
 * An empty base URL or model reads as the default, so clearing a field on the
 * card restores the free endpoint rather than storing a config that can never
 * run.
 */
export function sanitizeTranslationConfig(
  raw: Partial<TranslationConfig> | null | undefined
): TranslationConfig {
  const input = raw ?? {}
  const d = DEFAULT_TRANSLATION_CONFIG
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''
  const model = typeof input.model === 'string' ? input.model.trim() : ''
  const fields = (input.fields ?? {}) as Partial<Record<TranslatableField, unknown>>
  return {
    enabled: input.enabled === true,
    promptStyle: isTranslationPromptStyle(input.promptStyle) ? input.promptStyle : d.promptStyle,
    baseUrl: baseUrl || d.baseUrl,
    model: model || d.model,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey.trim() : '',
    sourceLanguage: isValidAppLocale(input.sourceLanguage) ? input.sourceLanguage : d.sourceLanguage,
    targetLanguages: sanitizeLanguageList(input.targetLanguages),
    // Absent reads as ON: both fields were on before the knob existed.
    fields: {
      overview: fields.overview !== false,
      plot_full: fields.plot_full !== false,
    },
    instruction:
      typeof input.instruction === 'string'
        ? input.instruction.trim().slice(0, TRANSLATION_INSTRUCTION_MAX_CHARS)
        : '',
    timeoutMs:
      input.timeoutMs == null
        ? d.timeoutMs
        : Math.round(
            clampNumber(input.timeoutMs, TRANSLATION_TIMEOUT_MIN_MS, TRANSLATION_TIMEOUT_MAX_MS, d.timeoutMs)
          ),
    callSpacingSeconds:
      input.callSpacingSeconds == null
        ? d.callSpacingSeconds
        : clampNumber(input.callSpacingSeconds, 0, TRANSLATION_SPACING_MAX_SECONDS, d.callSpacingSeconds),
  }
}

/** The fields switched on, in a stable order. */
export function enabledFields(config: Pick<TranslationConfig, 'fields'>): TranslatableField[] {
  return TRANSLATABLE_FIELDS.filter((f) => config.fields[f])
}

/**
 * The languages a run translates into: the stored list (or every enabled UI
 * language when none is stored), kept only where the interface offers it, and
 * never the source language. Ordered as the app lists its locales, so the job
 * and the card always walk them in the same order.
 */
export function resolveTargetLanguages(
  config: Pick<TranslationConfig, 'targetLanguages' | 'sourceLanguage'>,
  enabledUiLanguages: readonly string[]
): AppLocaleCode[] {
  const enabled = new Set(enabledUiLanguages)
  const wanted = config.targetLanguages ? new Set<string>(config.targetLanguages) : enabled
  return APP_LOCALE_OPTIONS.map((o) => o.code).filter(
    (code) => code !== config.sourceLanguage && enabled.has(code) && wanted.has(code)
  )
}

/**
 * `<root>/chat/completions` from whatever an operator pasted.
 *
 * Accepts the root, `<root>/v1`, or the full endpoint, because the README
 * gives `/v1` and an operator copying a curl line gives the whole path; a
 * doubled path 404s, which reads exactly like a server that is not there.
 *
 * `/v1` is added ONLY to a bare host (`http://gpu-box:8000`), where every
 * server this targets (vLLM, LM Studio, llama.cpp, the public endpoint) serves
 * the OpenAI API. A URL that already carries a path is used as given: the
 * OpenAI-compatible root is not always `/vN` — Google's is `…/v1beta/openai`,
 * Z.AI's `…/api/paas/v4` — and appending to those builds a URL that 404s.
 * Returns null for anything that is not an http(s) URL.
 */
export function chatCompletionsUrl(baseUrl: string): string | null {
  const root = apiRoot(baseUrl)
  return root ? `${root}/chat/completions` : null
}

/** `<root>/models`, for the card's model list. Same tolerance as above. */
export function modelsUrl(baseUrl: string): string | null {
  const root = apiRoot(baseUrl)
  return root ? `${root}/models` : null
}

function apiRoot(baseUrl: string): string | null {
  const trimmed = baseUrl.trim()
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  const root = trimmed.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '')
  const bareHost = parsed.pathname.replace(/\/+$/, '') === '' && !parsed.search
  return bareHost ? `${root}/v1` : root
}

/**
 * Index-Translate's names for the app's locales, in Chinese, as its prompt
 * names them. Taken from `call_api.py`'s LANG_NAMES (which keys Greek as
 * `ell_grek`, hence a table keyed by app locale rather than a lookup by code).
 * Typed as a full Record, so a locale added to the app is a compile error here
 * until it has a name — the official client would otherwise send the bare
 * code ("he") into a Chinese sentence.
 */
export const INDEX_TRANSLATE_LANGUAGE_NAMES: Record<AppLocaleCode, string> = {
  en: '英语',
  es: '西班牙语',
  de: '德语',
  fr: '法语',
  it: '意大利语',
  pt: '葡萄牙语',
  nl: '荷兰语',
  ru: '俄语',
  ja: '日语',
  zh: '中文',
  ko: '韩语',
  hi: '印地语',
  ar: '阿拉伯语',
  el: '希腊语',
}

/** English names for the instruction-style prompt. */
const ENGLISH_LANGUAGE_NAMES: Record<AppLocaleCode, string> = {
  en: 'English',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ru: 'Russian',
  ja: 'Japanese',
  zh: 'Simplified Chinese',
  ko: 'Korean',
  hi: 'Hindi',
  ar: 'Arabic',
  el: 'Greek',
}

/**
 * The Index-Translate prompt, exactly as `call_api.py`'s `build_prompt` builds
 * it with no glossary and genre "文本". Plain form without an instruction; the
 * instTrans constraint form with one. Each instruction line becomes a 【注意】
 * constraint unless it already carries a tag.
 */
export function buildIndexTranslatePrompt(
  text: string,
  target: AppLocaleCode,
  source: AppLocaleCode,
  instruction = ''
): string {
  const tgtName = INDEX_TRANSLATE_LANGUAGE_NAMES[target]
  const srcName = INDEX_TRANSLATE_LANGUAGE_NAMES[source]
  const stripped = text.trim()

  const constraints: string[] = []
  for (const raw of instruction.trim().split('\n')) {
    const line = raw.trim().replace(/^[0-9. ]+/, '')
    if (!line) continue
    constraints.push(
      line.startsWith('【硬性要求】') || line.startsWith('【注意】') || line.startsWith('【软性要求】')
        ? line
        : `【注意】${line}`
    )
  }

  if (constraints.length > 0) {
    const header = `请将以下${srcName}文本翻译成${tgtName}，并且严格遵循所有约束要求。`
    const reqLines = constraints.map((c, i) => `${i + 1}. ${c}`)
    return (
      `${header}\n\n` +
      `【源文】\n` +
      `${stripped}\n\n` +
      `【约束要求】\n` +
      `${reqLines.join('\n')}\n\n` +
      `只输出译文，不要有任何额外说明。`
    )
  }

  return `请将以下${srcName}文本翻译为${tgtName}，直接输出翻译结果，不要进行任何解释。\n\n${stripped}`
}

/** The system prompt for any other chat model. */
export function buildInstructionSystemPrompt(
  target: AppLocaleCode,
  source: AppLocaleCode,
  instruction = ''
): string {
  const lines = [
    `You are a professional translator of film and television synopses.`,
    `Translate the user's text from ${ENGLISH_LANGUAGE_NAMES[source]} into ${ENGLISH_LANGUAGE_NAMES[target]}.`,
    `Keep the meaning, tone and every name exactly; write titles and names the way ${ENGLISH_LANGUAGE_NAMES[target]} publications write them.`,
    `Output only the translation: no notes, no quotation marks around it, no explanation, no original text.`,
  ]
  if (instruction.trim()) lines.push(instruction.trim())
  return lines.join('\n')
}

/**
 * The output allowance for one synopsis. The official client uses 1024, which
 * truncates a long IMDb synopsis (`plot_full` runs to 4,000 characters) once
 * the target script costs more tokens per character than English, as Greek
 * and Hindi do. A ceiling, not a reservation, so headroom costs nothing on a
 * short text.
 */
export function maxTokensFor(text: string): number {
  return Math.min(8192, Math.max(1024, Math.ceil(text.length * 1.5) + 256))
}

/**
 * The longest piece of text one request carries.
 *
 * THE PUBLIC ENDPOINT'S GATEWAY ANSWERS 504 AT EXACTLY TEN SECONDS, whatever
 * the client's timeout and whatever `max_tokens` says, so a synopsis is
 * translatable in one call only if the model can write the whole translation
 * inside that window. Measured 2026-10-10 against `Index-Translate-35B-A3B`:
 * into Greek, 575/863/1,151 characters took 2.8/3.6/4.6s and 1,727 hit the
 * wall at 10.2s; into German 1,727 took 4.3s and 3,167 hit it. So the failures
 * were never about WHICH titles — they were the long `plot_full`s, which fail
 * identically on every run (greedy decoding, same text, same length). Greek
 * and Hindi cost more tokens per character than German, hence the margin: 700
 * characters sits near three seconds into Greek and leaves room for a busy
 * shared server.
 */
export const TRANSLATION_CHUNK_CHARS = 700

export interface TextChunk {
  text: string
  /** How this chunk is joined to the one before it: '' (first), 'sentence' or 'paragraph'. */
  joinBefore: '' | 'sentence' | 'paragraph'
}

/**
 * Sentence-sized units of one paragraph. A boundary is sentence punctuation
 * (optionally closed by a quote or bracket) FOLLOWED BY WHITESPACE, and only
 * the whitespace is removed — so "3.5 million", "U.S." and a leading "..." stay
 * exactly as written. A match-based splitter silently drops any character it
 * cannot match and breaks "3.5" into "3." + "5", which the join then sends as
 * "3. 5": the text translated would no longer be the text stored.
 */
function sentencesOf(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?…]["'”’)\]]*)\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * A sentence longer than the limit, cut at the last space before it. Only a
 * single "word" longer than half the limit (a URL, say) is cut mid-word.
 */
function hardSplit(sentence: string, maxChars: number): string[] {
  const out: string[] = []
  let rest = sentence
  while (rest.length > maxChars) {
    const cut = rest.lastIndexOf(' ', maxChars)
    const at = cut > maxChars / 2 ? cut : maxChars
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Cut a synopsis into pieces of at most `maxChars`, on paragraph breaks first,
 * then sentence ends, then (for a single overlong sentence) spaces. A text
 * under the limit is ONE chunk, so a short overview builds exactly the request
 * it always did. Pieces are packed greedily so a long synopsis is as few calls
 * as the limit allows — each call is a paced request to a shared free service.
 */
export function splitForTranslation(text: string, maxChars = TRANSLATION_CHUNK_CHARS): TextChunk[] {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed ? [{ text: trimmed, joinBefore: '' }] : []

  const chunks: TextChunk[] = []
  const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  for (const paragraph of paragraphs) {
    const units = sentencesOf(paragraph).flatMap((s) => (s.length > maxChars ? hardSplit(s, maxChars) : [s]))
    let current = ''
    let firstInParagraph = true
    const flush = () => {
      if (!current) return
      chunks.push({
        text: current,
        joinBefore: chunks.length === 0 ? '' : firstInParagraph ? 'paragraph' : 'sentence',
      })
      firstInParagraph = false
      current = ''
    }
    for (const unit of units) {
      if (current && current.length + 1 + unit.length > maxChars) flush()
      current = current ? `${current} ${unit}` : unit
    }
    flush()
  }
  return chunks
}

/**
 * Put translated chunks back together. Sentences are joined with a space,
 * except into Chinese and Japanese, which write none between sentences;
 * paragraphs keep their blank line.
 */
export function joinTranslatedChunks(
  parts: ReadonlyArray<{ text: string; joinBefore: TextChunk['joinBefore'] }>,
  target: AppLocaleCode
): string {
  const sentenceGap = target === 'zh' || target === 'ja' ? '' : ' '
  return parts
    .map((p) => (p.joinBefore === 'paragraph' ? '\n\n' : p.joinBefore === 'sentence' ? sentenceGap : '') + p.text)
    .join('')
}

/**
 * The provider's message and requested wait from an error body. Errors arrive
 * in several shapes: OpenAI's `{ error: { message } }`, a bare `{ message }`,
 * and FastAPI's `{ detail }` — which the public endpoint uses with an OpenAI
 * error NESTED inside it (`{ detail: { error: { message, retry_after } } }`),
 * so both layers are read. Non-JSON falls back to the raw text.
 */
export function readErrorBody(text: string): { message: string | null; retryAfterSeconds: number | null } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { message: text.trim().slice(0, 300) || null, retryAfterSeconds: null }
  }
  const layers: unknown[] = [json]
  const detail = (json as { detail?: unknown } | null)?.detail
  if (detail && typeof detail === 'object') layers.push(detail)

  let message: string | null = null
  let retryAfterSeconds: number | null = null
  for (const layer of layers) {
    const obj = layer as { error?: unknown; message?: unknown; detail?: unknown; retry_after?: unknown }
    const error = obj.error
    const errObj = error && typeof error === 'object' ? (error as { message?: unknown; retry_after?: unknown }) : null
    message ??=
      typeof error === 'string'
        ? error
        : typeof errObj?.message === 'string'
          ? errObj.message
          : typeof obj.message === 'string'
            ? obj.message
            : typeof obj.detail === 'string'
              ? obj.detail
              : null
    for (const raw of [errObj?.retry_after, obj.retry_after]) {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
      if (retryAfterSeconds == null && Number.isFinite(n) && n >= 0) retryAfterSeconds = n
    }
  }
  return { message: message ?? (text.trim().slice(0, 300) || null), retryAfterSeconds }
}

/**
 * How long to wait before retry number `attempt` (1-based) of a 429, in ms.
 *
 * THE ENDPOINT'S OWN FIGURE IS A FLOOR, NOT THE ANSWER. The public endpoint's
 * limit is 60,000 tokens per minute per IP and it answers "retry in 1s" when
 * the window is a hair over (measured: current 59,720, requested 567). A
 * sliding minute that full frees a few hundred tokens a second at best, so a
 * one-second wait mostly buys a second refusal. The wait is therefore the
 * larger of what the server asked for (body `retry_after`, then the
 * `Retry-After` header in seconds — an HTTP date reads as absent) and a
 * backoff of 5s doubling per attempt, capped at {@link RATE_LIMIT_MAX_WAIT_MS}
 * so a server asking for an hour fails the call instead of parking the job.
 */
export function rateLimitWaitMs(
  bodyRetryAfterSeconds: number | null,
  header: string | null,
  attempt = 1
): number {
  const headerSeconds = header != null && header.trim() !== '' ? Number(header) : NaN
  const asked =
    bodyRetryAfterSeconds ?? (Number.isFinite(headerSeconds) && headerSeconds >= 0 ? headerSeconds : 0)
  const backoff = RATE_LIMIT_BASE_WAIT_S * 2 ** Math.max(0, attempt - 1)
  return Math.round(Math.min(RATE_LIMIT_MAX_WAIT_MS, Math.max(asked, backoff) * 1000))
}

export const RATE_LIMIT_BASE_WAIT_S = 5
export const RATE_LIMIT_MAX_WAIT_MS = 60_000
/**
 * Retries of ONE request after a 429. 5 + 10 + 20 + 40 + 60 + 60 seconds is
 * over three minutes — three full windows of a per-minute limit — after which
 * the failure is reported as before and the pair moves to the back of the queue.
 */
export const RATE_LIMIT_MAX_RETRIES = 6

export interface ChatCompletionBody {
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  temperature: number
  max_tokens: number
  stream: false
  chat_template_kwargs?: { enable_thinking: boolean }
}

/**
 * The request body. Greedy decoding (temperature 0) in both styles, as the
 * model card prescribes for Index-Translate. `chat_template_kwargs` only for
 * the Index-Translate style: its client sends it so the model's reasoning
 * cannot replace the translation, while a stricter OpenAI-compatible server
 * may reject a field it does not know.
 */
export function buildChatCompletionBody(
  config: Pick<TranslationConfig, 'model' | 'promptStyle' | 'instruction'>,
  text: string,
  target: AppLocaleCode,
  source: AppLocaleCode
): ChatCompletionBody {
  const base = {
    model: config.model,
    temperature: 0,
    max_tokens: maxTokensFor(text),
    stream: false as const,
  }
  if (config.promptStyle === 'index-translate') {
    return {
      ...base,
      messages: [
        { role: 'user', content: buildIndexTranslatePrompt(text, target, source, config.instruction) },
      ],
      chat_template_kwargs: { enable_thinking: false },
    }
  }
  return {
    ...base,
    messages: [
      { role: 'system', content: buildInstructionSystemPrompt(target, source, config.instruction) },
      { role: 'user', content: text.trim() },
    ],
  }
}

/** Drop a reasoning block if one leaked through — `call_api.py`'s strip_think. */
export function stripThink(text: string): string {
  let out = text
  const end = out.indexOf('</think>')
  if (end !== -1) out = out.slice(end + '</think>'.length)
  out = out.trim()
  if (out.startsWith('<think>')) out = out.slice('<think>'.length)
  return out.trim()
}

export type CompletionReading =
  | { ok: true; text: string }
  | { ok: false; reason: string }

/**
 * Read one chat-completion response into a translation, or the reason it is
 * not one. A truncated answer is refused even when it has text — storing a
 * synopsis that stops mid-sentence would retire the title until its source
 * changes, the short-text lesson (F-137). An answer identical to a
 * sentence-length source is refused too: a model that echoes its input has not
 * translated anything, and stored, that echo would be shown as the translation
 * ({@link ECHO_CHECK_MIN_CHARS} for why a short source is exempt).
 */
export function readCompletion(json: unknown, sourceText: string): CompletionReading {
  const choice = (json as { choices?: unknown[] } | null)?.choices?.[0] as
    | { message?: { content?: unknown }; finish_reason?: unknown }
    | undefined
  if (!choice) return { ok: false, reason: 'The response carried no choices' }
  const content = choice.message?.content
  if (typeof content !== 'string') return { ok: false, reason: 'The response carried no text' }
  if (choice.finish_reason === 'length') {
    return { ok: false, reason: 'The translation was cut off at the output limit' }
  }
  const text = stripThink(content)
  if (!text) return { ok: false, reason: 'The model returned an empty translation' }
  if (sourceText.trim().length >= ECHO_CHECK_MIN_CHARS && normalizeForEcho(text) === normalizeForEcho(sourceText)) {
    return { ok: false, reason: 'The model returned the source text unchanged' }
  }
  return { ok: true, text }
}

/**
 * Below this, an answer identical to its source is accepted. A sentence that
 * comes back unchanged was not translated; a one-word or very short overview
 * ("TBA", a title, a name) can legitimately be the same in both languages, and
 * refusing it would leave it pending and re-send it on every run, forever.
 */
export const ECHO_CHECK_MIN_CHARS = 40

function normalizeForEcho(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Model ids from an OpenAI-style `/models` listing; anything else is empty. */
export function readModelList(json: unknown): string[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const ids = data
    .map((m) => (m && typeof (m as { id?: unknown }).id === 'string' ? (m as { id: string }).id : null))
    .filter((id): id is string => !!id)
  return [...new Set(ids)].sort()
}
