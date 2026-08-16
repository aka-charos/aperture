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
   * were recovered individually — worth logging, since it says the response was
   * cut off rather than malformed.
   */
  mode: 'json' | 'salvaged' | 'none'
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

/**
 * Both key orders the model might emit, as complete entries only.
 *
 * `(?:[^"\\]|\\.)*"` cannot run past the closing quote it is looking for, so a
 * string the response stopped in the middle of simply fails to match. That is
 * the whole safety property: the half-written entry at the end of a truncated
 * array is skipped, and every finished one before it is kept.
 */
const ENTRY_PATTERNS: Array<{ pattern: RegExp; index: 1 | 2; text: 1 | 2 }> = [
  {
    pattern: /"index"\s*:\s*(\d+)\s*,\s*"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
    index: 1,
    text: 2,
  },
  {
    pattern: /"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"index"\s*:\s*(\d+)/g,
    index: 2,
    text: 1,
  },
]

/** Unescape a matched string body by letting JSON.parse do it. */
function decodeJsonString(body: string): string | null {
  try {
    const value: unknown = JSON.parse(`"${body}"`)
    if (typeof value !== 'string') return null
    const text = value.trim()
    return text || null
  } catch {
    return null
  }
}

function readSalvaged(text: string): Map<number, string> {
  const byIndex = new Map<number, string>()

  for (const { pattern, index, text: textGroup } of ENTRY_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const position = Number.parseInt(match[index], 10)
      if (!Number.isInteger(position)) continue
      // First writer wins, so the two passes cannot disagree about an entry.
      if (byIndex.has(position)) continue
      const decoded = decodeJsonString(match[textGroup])
      if (decoded) byIndex.set(position, decoded)
    }
  }

  return byIndex
}

/**
 * Read every explanation the response actually contains.
 *
 * Strict JSON first, because a complete response should be read the strict way
 * — nested structures and escapes are the parser's problem, not a regex's. The
 * salvage is only reached when that fails, which in practice means the response
 * was cut off.
 *
 * Never throws, and an unreadable response is an empty map rather than an
 * error: the caller fills gaps with its own fallback text, so partial output is
 * an ordinary case here, not an exception.
 */
export function parseExplanationResponse(raw: string | null | undefined): ParsedExplanations {
  const text = fromJsonStart(stripFences(raw ?? ''))
  if (!text) return { byIndex: new Map(), mode: 'none' }

  const strict = readStrict(text)
  if (strict && strict.size > 0) return { byIndex: strict, mode: 'json' }

  const salvaged = readSalvaged(text)
  return { byIndex: salvaged, mode: salvaged.size > 0 ? 'salvaged' : 'none' }
}
