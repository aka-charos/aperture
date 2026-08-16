/**
 * Reading a batch of recommendation explanations back out of a model response.
 *
 * Pure, and deliberately free of imports, so the salvage below can be tested
 * against real truncated output without a database or a provider — the same
 * split as watchedExclusion.ts and enrichment/pending.ts.
 *
 * The bug this exists to fix: both generators asked the model for one JSON
 * object holding ten explanations, ran `JSON.parse` on it, and on failure
 * replaced *the whole batch* with template sentences. Measured on the live
 * instance, that is exactly what happened — three parse errors reading
 * "Unterminated string in JSON at position 3068" and the like, with the ledger
 * showing `completion_tokens` pinned at the 3000-token cap and up to 2,283 of
 * those spent on reasoning. The model was writing good explanations and running
 * out of budget mid-sentence, and one truncated character discarded nine
 * finished ones alongside the broken tenth.
 *
 * Two responses to that, both here: settings that give a reasoning model room
 * (explanationBatchSettings), and a reader that keeps whatever actually
 * arrived (parseExplanationResponse).
 *
 * The reader then produced a second, worse incident of its own, and the shape
 * of it is the reason this file is written the way it is. Recovery was a regex
 * whose string body stopped at the first unescaped quote; a model writing film
 * titles in bare double quotes therefore yielded ten "successful" matches per
 * batch, each cut off at the first title, and the caller's only check was
 * whether the count came up short. It did not. Every explanation on the page
 * became a sentence fragment and every log line said the run had succeeded.
 *
 * So there are two rules here now, and they are what the tests pin. Recovery
 * decides where a string ENDS from structure rather than from the first quote
 * it meets (isValueEnd), and anything it recovers must still read as a finished
 * sentence before it is handed back (looksComplete) — because a wrong guess
 * that reaches the page beats no guess at all only if it is a whole one.
 */

// ============================================================================
// Batch settings
// ============================================================================

export interface ExplanationBatchSettings {
  /** How many recommendations to ask for in one request. */
  batchSize: number
  /** Ceiling on the response, reasoning included. */
  maxTokens: number
}

/**
 * Batch settings for a text-generation provider, tiered by context window.
 *
 * Pure so the numbers live in one place and can be asserted; both generators
 * wrap it with the config lookup. They previously held identical private
 * copies, which is how one could have been raised without the other.
 *
 * On the token ceiling: `maxTokens` is a cap, not a reservation — providers
 * bill what is actually produced, so headroom on the large-context tier is
 * free for a healthy call and is the difference between a complete answer and
 * a discarded one for a model that thinks first. Ten explanations measured
 * ~900-1,500 tokens of prose against reasoning that swung between 0 and 2,283
 * in twenty consecutive calls, so the ceiling is set far above the sum rather
 * than close to it: the failure is silent, and the saving from a tight cap is
 * nil.
 *
 * The lower tiers are NOT raised to match. Their numbers are bounded by the
 * model's whole context window (Groq at 8K, Ollama's 4K default), where a
 * larger output ceiling would push the request past what the model can hold —
 * a different and worse failure than the one being fixed.
 */
export function explanationBatchSettings(
  provider: string | null | undefined
): ExplanationBatchSettings {
  if (!provider) {
    return { batchSize: 3, maxTokens: 1000 }
  }

  // Large context: OpenAI (128K), Anthropic (200K), Google (1M+), DeepSeek
  // (64K), OpenRouter (a router in front of those same large-context models).
  const largeContextProviders = ['openai', 'anthropic', 'google', 'deepseek', 'openrouter']
  if (largeContextProviders.includes(provider)) {
    return { batchSize: 10, maxTokens: 16000 }
  }

  // Medium context: Groq (8K context)
  if (provider === 'groq') {
    return { batchSize: 5, maxTokens: 1500 }
  }

  // Small context: Ollama (default 4K), OpenAI-compatible (varies)
  return { batchSize: 3, maxTokens: 1000 }
}

// ============================================================================
// Reading the response
// ============================================================================

export interface ParsedExplanations {
  /** The prompt's 1-based index → the explanation written for it. */
  byIndex: Map<number, string>
  /**
   * How the text was read. `salvaged` means the JSON did not parse and entries
   * were recovered individually — always worth logging, since it means the
   * model produced something the strict reader could not accept.
   */
  mode: 'json' | 'salvaged' | 'none'
  /**
   * Salvaged entries thrown away because they did not read as finished
   * sentences. Non-zero means the recovery was ambiguous and the caller's
   * template is being used instead — the interesting number when a batch looks
   * complete but the page does not.
   */
  rejected: number
}

const FENCED_BLOCK = /```(?:json)?\s*([\s\S]*?)```/i
const FENCE_OPEN = /```(?:json)?\s*/i

/**
 * Pull the payload out of a markdown code fence.
 *
 * Neither pattern is anchored, because models routinely write a sentence of
 * preamble before the fence. A *complete* block is preferred, and the opener
 * alone is the fallback: a response cut off mid-array keeps its ```json opener
 * and never gets a closer, which is precisely the case that has to survive.
 */
function stripFences(raw: string): string {
  const text = raw.trim()

  const closed = text.match(FENCED_BLOCK)
  if (closed) return closed[1].trim()

  const opener = text.match(FENCE_OPEN)
  if (opener?.index !== undefined) {
    return text.slice(opener.index + opener[0].length).trim()
  }

  return text
}

/** Skip any preamble the model wrote before the JSON itself. */
function fromJsonStart(text: string): string {
  if (text.startsWith('{') || text.startsWith('[')) return text
  const start = text.search(/[[{]/)
  return start === -1 ? text : text.slice(start)
}

function readEntry(entry: unknown, into: Map<number, string>): void {
  if (!entry || typeof entry !== 'object') return
  const { index, explanation } = entry as { index?: unknown; explanation?: unknown }
  if (!Number.isInteger(index) || typeof explanation !== 'string') return
  const text = explanation.trim()
  if (text) into.set(index as number, text)
}

/** The whole response as JSON — an `{ explanations: [...] }` object or a bare array. */
function readStrict(text: string): Map<number, string> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { explanations?: unknown } | null)?.explanations
  if (!Array.isArray(list)) return null

  const byIndex = new Map<number, string>()
  for (const entry of list) readEntry(entry, byIndex)
  return byIndex
}

// ----------------------------------------------------------------------------
// Salvage
// ----------------------------------------------------------------------------
//
// Why this is a scanner and not a regular expression.
//
// The first version matched a string body as `(?:[^"\\]|\\.)*"`, reasoning that
// a body which cannot cross a quote cannot cross the END of the string either,
// so a truncated entry would fail to match and be skipped. That is true of
// truncation and false of everything else, and the case it misses is the one
// that actually happens: the model writes a film title in bare double quotes
// inside its own prose. Measured live, `...the moral murk of "Parasite", this
// film...` matched up to the quote before the title, so a perfectly complete
// explanation was stored as "If you were pulled into the moral murk of" — and
// since ten of ten entries "matched", the short-batch warning never fired and
// the run logged as a clean success.
//
// The model is doing what the prompt taught it: every title in the prompt is
// written in double quotes. That is fixed at the prompt too, but a prompt rule
// is a request, so the reader has to hold regardless.

/** A real closing quote is followed by the end of the object or array... */
const STRUCTURE_AHEAD = /^\s*[}\]]/
/** ...or by a comma introducing the next `"key":`... */
const NEXT_KEY_AHEAD = /^\s*,\s*"[^"\\]{1,40}"\s*:/
/** ...or, in a response cut off after a complete value, by nothing at all. */
const NOTHING_AHEAD = /^\s*$/

/**
 * How far past a candidate closing quote to look. Only ever needs to cover the
 * longest key plus its punctuation; a bounded slice keeps the check O(1) rather
 * than re-scanning the tail of the document at every quote.
 */
const LOOKAHEAD_CHARS = 64

/**
 * Is the quote at `index` the end of the JSON value, or one the model wrote
 * inside its own prose?
 *
 * Note that a bare `"\s*[,}\]]` test is not enough, and fails on the most
 * common phrasing there is: in `I loved "Heat", but colder` the quote after
 * Heat IS followed by a comma. Requiring a `"key":` after that comma is what
 * separates the two, because prose does not continue `", "index":`.
 */
function isValueEnd(text: string, index: number): boolean {
  const ahead = text.slice(index + 1, index + 1 + LOOKAHEAD_CHARS)
  return STRUCTURE_AHEAD.test(ahead) || NEXT_KEY_AHEAD.test(ahead) || NOTHING_AHEAD.test(ahead)
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/** Decode one escape sequence, or null if the response stopped inside it. */
function readEscape(text: string, index: number): { value: string; end: number } | null {
  const next = text[index + 1]
  if (next === undefined) return null

  if (next === 'u') {
    const hex = text.slice(index + 2, index + 6)
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null
    // Per code unit, so a surrogate pair written as two escapes recombines.
    return { value: String.fromCharCode(Number.parseInt(hex, 16)), end: index + 6 }
  }

  const simple = SIMPLE_ESCAPES[next]
  if (simple !== undefined) return { value: simple, end: index + 2 }

  // Not a JSON escape at all — the model wrote a stray backslash. Keep both
  // characters rather than silently eating one.
  return { value: `\\${next}`, end: index + 2 }
}

/**
 * Read a JSON string starting at the opening quote, tolerating unescaped quotes
 * in the body. Null when the string never closes, which is what a genuinely
 * truncated response looks like.
 */
function readString(text: string, start: number): { value: string; end: number } | null {
  let out = ''
  let i = start + 1

  while (i < text.length) {
    const char = text[i]

    if (char === '\\') {
      const escape = readEscape(text, i)
      if (!escape) return null
      out += escape.value
      i = escape.end
      continue
    }

    if (char === '"') {
      if (isValueEnd(text, i)) return { value: out, end: i + 1 }
      out += '"'
      i++
      continue
    }

    out += char
    i++
  }

  return null
}

/**
 * Shortest text that can plausibly be a finished explanation. The prompt asks
 * for three or four sentences and even the non-AI template runs past 100
 * characters, so this only ever catches wreckage.
 */
const SALVAGE_MIN_CHARS = 40

/**
 * Terminal punctuation, with any closing bracket or quote allowed after it so
 * an explanation ending on a quoted title still passes.
 */
const SENTENCE_END = /[.!?…。！？؟۔][)\]}"'”’»】]*$/u

/**
 * Would this read as a finished sentence on the page?
 *
 * Applied to salvaged entries only. A strict parse returns exactly the string
 * the model emitted, so a short one there is the model's judgement and not a
 * reading error; salvage is inference, and inference that lands on "If" must
 * lose to the template. The failure mode this exists for is not hypothetical —
 * it shipped.
 */
function looksComplete(text: string): boolean {
  return text.length >= SALVAGE_MIN_CHARS && SENTENCE_END.test(text)
}

/** The two keys an entry is built from, in whichever order the model wrote them. */
const KEY_TOKEN = /"(index|explanation)"\s*:\s*/g

function readSalvaged(text: string): { byIndex: Map<number, string>; rejected: number } {
  const byIndex = new Map<number, string>()
  let rejected = 0

  let pendingIndex: number | null = null
  let pendingText: string | null = null

  const commit = () => {
    if (pendingIndex === null || pendingText === null) return
    // First writer wins, so a repeated index cannot overwrite a good entry.
    if (!byIndex.has(pendingIndex)) {
      if (looksComplete(pendingText)) byIndex.set(pendingIndex, pendingText)
      else rejected++
    }
    pendingIndex = null
    pendingText = null
  }

  KEY_TOKEN.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = KEY_TOKEN.exec(text)) !== null) {
    const after = match.index + match[0].length

    if (match[1] === 'index') {
      const digits = /^\d+/.exec(text.slice(after, after + 12))
      if (!digits) continue
      pendingIndex = Number.parseInt(digits[0], 10)
      KEY_TOKEN.lastIndex = after + digits[0].length
      commit()
      continue
    }

    if (text[after] !== '"') continue

    const value = readString(text, after)
    // An unterminated string is the end of anything readable: the response
    // stopped inside it, so there is no later entry to find.
    if (!value) break

    pendingText = value.value.trim() || null
    // Resume past the value, so quotes inside the prose can never be mistaken
    // for the start of a new token.
    KEY_TOKEN.lastIndex = value.end
    commit()
  }

  return { byIndex, rejected }
}

/**
 * Read every explanation the response actually contains.
 *
 * Strict JSON first, because a well-formed response should be read the strict
 * way — nested structures and escapes are the parser's problem, not ours, and
 * anything it returns is exactly what the model wrote. Salvage is reached only
 * when that fails, which in practice means one of two things: the response was
 * cut off, or the model left a quote unescaped inside its prose.
 *
 * Never throws, and an unreadable response is an empty map rather than an
 * error: the caller fills gaps with its own fallback text, so partial output is
 * an ordinary case here, not an exception.
 */
export function parseExplanationResponse(raw: string | null | undefined): ParsedExplanations {
  const text = fromJsonStart(stripFences(raw ?? ''))
  if (!text) return { byIndex: new Map(), mode: 'none', rejected: 0 }

  const strict = readStrict(text)
  if (strict && strict.size > 0) return { byIndex: strict, mode: 'json', rejected: 0 }

  const { byIndex, rejected } = readSalvaged(text)
  return {
    byIndex,
    // `rejected` alone still counts as salvage having run: it says the strict
    // parse failed and recovery was attempted, which is the fact worth logging.
    mode: byIndex.size > 0 || rejected > 0 ? 'salvaged' : 'none',
    rejected,
  }
}

// ============================================================================
// Reporting
// ============================================================================

export interface ExplanationBatchOutcome {
  mode: ParsedExplanations['mode']
  /** Explanations the reader produced. */
  parsed: number
  /** Salvaged entries discarded as fragments. */
  rejected: number
  /** Explanations the prompt asked for. */
  expected: number
  /** The provider's finish reason, when the caller has one. */
  finishReason?: string
}

/**
 * What to say about a finished batch, or null when it went cleanly.
 *
 * Shared because the alternative is two copies, and two copies of a condition
 * is how the last one came to be wrong: the check was "did we get fewer than we
 * asked for", which a batch of ten fragments passes. Anything the strict reader
 * would not accept is now worth a line, whatever the count says.
 */
export function describeExplanationBatch(outcome: ExplanationBatchOutcome): string | null {
  const { mode, parsed, rejected, expected, finishReason } = outcome

  const complete = parsed >= expected
  if (mode === 'json' && complete) return null

  // Checked first because it is a cause rather than a symptom: a reasoning
  // model spends its thinking from the same ceiling as its prose, so the fix
  // is the token budget and not the reader.
  if (finishReason === 'length') {
    return 'Explanation batch hit the output token cap; using fallbacks for the rest'
  }

  if (mode === 'none') {
    return 'Explanation response could not be read at all; using fallbacks for the whole batch'
  }

  if (rejected > 0) {
    return 'Explanation response was malformed and some recovered entries were incomplete; using fallbacks for those'
  }

  if (mode === 'salvaged') {
    return complete
      ? 'Explanation response was not valid JSON; every entry was recovered individually'
      : 'Explanation response was not valid JSON; using fallbacks for what could not be recovered'
  }

  return 'Explanation batch came back short; using fallbacks for the rest'
}
