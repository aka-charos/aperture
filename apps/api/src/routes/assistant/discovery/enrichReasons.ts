/**
 * Rewrite per-card "why it fits" notes so they read like insight, not web copy.
 *
 * The notes coming out of the discovery pipeline are EXTRACTIVE: the structuring
 * pass condenses whatever the search results said, so they inherit that hedged,
 * third-party voice — "is often described as a precursor to X, sharing a similar
 * atmosphere". Ask a model to elaborate in chat and you get something far
 * better ("Lynch described it as a psychogenic fugue"), because it is then
 * GENERATING from knowledge instead of summarizing a snippet.
 *
 * This pass closes that gap for the cards the user actually sees: short
 * concurrent batches on a writing model (text-generation → chat — deliberately
 * NOT the cheap structuring model), grounded by the research note plus the
 * library synopsis.
 *
 * Two deliberate choices:
 * - Line format, not structured output. The writing model is user-selectable and
 *   may not emit reliable JSON (see routeIntent), and a schema failure here would
 *   cost us the notes entirely.
 * - Fails open, per item. Anything unparsed keeps its original note, so the cards
 *   can never come back worse than they went in.
 */
import { generateText, type LanguageModel } from 'ai'
import {
  getTextGenerationModelInstance,
  getChatModelInstance,
  createChildLogger,
} from '@aperture/core'
import { recordLlmError } from '../helpers/errors.js'
import type { ContentItem } from '../schemas/index.js'

const logger = createChildLogger('discovery-reasons')

/** Keep retries low — this is an enhancement; latency matters more than a retry. */
const SDK_MAX_RETRIES = 1
/** Synopsis context per title (enough to ground, small enough to stay cheap). */
const MAX_SYNOPSIS_CHARS = 240
/** Guard against a model that ignores the length instruction. */
const MAX_REASON_CHARS = 320
/**
 * Titles per request. One request for the whole list stopped roughly halfway
 * (24 asked, 12 answered), which silently left the trailing section — "Also
 * worth checking" — with no notes at all. Small chunks run concurrently, so
 * this is both more reliable and faster than a single long completion.
 */
const BATCH_SIZE = 8
/** Output budget per title, generous enough that a 30-word answer never truncates. */
const TOKENS_PER_REASON = 120

/**
 * A model chosen for prose. Text-generation first (its whole purpose), then the
 * chat model (what writes the good elaborations today). Never the web-search
 * role — that one is a cheap grounding/structuring model.
 */
async function getWritingModel(): Promise<LanguageModel> {
  try {
    return await getTextGenerationModelInstance()
  } catch {
    // Text-generation role not configured — fall back to the chat model.
  }
  return await getChatModelInstance()
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function buildPrompt(queryText: string, items: ContentItem[]): string {
  const lines = items.map((item, i) => {
    const parts = [`${i + 1}. ${item.name}`]
    if (item.subtitle) parts.push(`(${item.subtitle})`)
    if (item.reason) parts.push(`— research note: ${truncate(item.reason, 240)}`)
    if (item.overview) parts.push(`— synopsis: ${truncate(item.overview, MAX_SYNOPSIS_CHARS)}`)
    return parts.join(' ')
  })

  return (
    `The user asked: "${queryText}"\n\n` +
    'For each numbered title below, write ONE or TWO sentences telling the user why it fits that request.\n' +
    'Rules:\n' +
    '- Be specific and concrete: the shared structural device, the tonal or thematic link, the filmmaker\'s own framing, the exact thing it has in common. Details a film fan would find satisfying.\n' +
    '- Write in your own voice, with confidence. NEVER hedge or attribute: no "is often described as", "critics have noted", "is considered", "is listed as", "fans might enjoy".\n' +
    '- Do NOT summarize the plot — the card already shows the synopsis next to your note.\n' +
    '- Never invent facts. If you know nothing beyond the research note, just sharpen that note into direct, specific language.\n' +
    '- Around 25-35 words each. No title, no markdown, no bullet points.\n\n' +
    'Reply with exactly one line per title in the form `<number> | <your sentences>` and nothing else.\n\n' +
    lines.join('\n')
  )
}

/**
 * Parse `<number> | <reason>` lines tolerantly (accepts . ) : - as separators too,
 * and strips stray markdown/quotes). Returns 1-based index → reason.
 */
export function parseReasonLines(text: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const rawLine of (text ?? '').split('\n')) {
    const match = /^\s*(\d{1,2})\s*[|.):\-–]\s*(.+)$/.exec(rawLine)
    if (!match) continue
    const index = Number.parseInt(match[1], 10)
    if (!Number.isFinite(index) || index < 1) continue
    const reason = match[2]
      .replace(/\*\*/g, '')
      .replace(/^["'`]|["'`]$/g, '')
      .trim()
    if (!reason) continue
    if (!out.has(index)) out.set(index, truncate(reason, MAX_REASON_CHARS))
  }
  return out
}

/** One item plus its position in the caller's list, so chunks can be reassembled. */
interface IndexedItem {
  index: number
  item: ContentItem
}

/**
 * Rewrite one chunk. The prompt numbers titles from 1 within the chunk; the
 * returned indices are translated back to the caller's positions.
 */
async function rewriteChunk(
  model: LanguageModel,
  queryText: string,
  chunk: IndexedItem[]
): Promise<Array<{ index: number; reason: string }>> {
  const { text } = await generateText({
    model,
    maxRetries: SDK_MAX_RETRIES,
    maxOutputTokens: chunk.length * TOKENS_PER_REASON + 200,
    prompt: buildPrompt(
      queryText,
      chunk.map((entry) => entry.item)
    ),
  })

  const byLocalIndex = parseReasonLines(text)
  const out: Array<{ index: number; reason: string }> = []
  chunk.forEach((entry, i) => {
    const reason = byLocalIndex.get(i + 1)
    if (reason) out.push({ index: entry.index, reason })
  })
  return out
}

function chunkBy<T>(list: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size))
  return chunks
}

/**
 * Return the items with richer `reason` notes. Never throws and never returns
 * fewer items than it was given; any item the model didn't cover keeps its
 * original note.
 */
export async function enrichCardReasons(
  items: ContentItem[],
  queryText: string
): Promise<ContentItem[]> {
  if (items.length === 0) return items

  let model: LanguageModel
  try {
    model = await getWritingModel()
  } catch (err) {
    await recordLlmError(err, { context: 'discovery reason enrichment', logger })
    return items
  }

  const rewritten = new Map<number, string>()
  let remaining: IndexedItem[] = items.map((item, index) => ({ index, item }))
  let firstError: unknown = null

  // Two passes at most: the second only retries titles the first didn't answer
  // for, so a single dropped chunk costs one extra short call rather than the
  // whole trailing half of the list.
  for (let pass = 0; pass < 2 && remaining.length > 0; pass++) {
    const results = await Promise.all(
      chunkBy(remaining, BATCH_SIZE).map((chunk) =>
        rewriteChunk(model, queryText, chunk).catch((err) => {
          firstError ??= err
          return [] as Array<{ index: number; reason: string }>
        })
      )
    )
    for (const { index, reason } of results.flat()) rewritten.set(index, reason)
    remaining = remaining.filter((entry) => !rewritten.has(entry.index))
  }

  if (firstError) {
    // Enhancement only — record it, then ship whatever did come back.
    await recordLlmError(firstError, { context: 'discovery reason enrichment', logger })
  }

  if (rewritten.size === 0) {
    logger.warn({ items: items.length }, 'Reason enrichment produced nothing; keeping original notes')
    return items
  }

  logger.info(
    { items: items.length, rewritten: rewritten.size, missing: remaining.length },
    'Card reasons enriched'
  )
  return items.map((item, i) => {
    const reason = rewritten.get(i)
    return reason ? { ...item, reason } : item
  })
}
