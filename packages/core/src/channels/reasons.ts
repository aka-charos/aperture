/**
 * Explain why each generated pick belongs in a channel's playlist/collection.
 *
 * The recommender picks by cosine distance against a taste vector built from the channel's seeds,
 * genres and preference text. That number is meaningful to the ranking and meaningless to the
 * person approving the list — "0.83" tells them nothing about why Bad Taste is sitting under a
 * brief about practical effects and tonal whiplash. This turns the brief and the pick into one
 * sentence a human can accept or reject on.
 *
 * Shaped after the assistant's card-reason pass: short concurrent batches, line format rather
 * than structured output (the writing model is user-selectable and may not emit reliable JSON,
 * and a schema failure would cost the notes entirely), and failing open per item — an unanswered
 * title simply has no note, never a broken preview.
 */
import { generateText, type LanguageModel } from 'ai'
import { createChildLogger } from '../lib/logger.js'
import { query, queryOne } from '../lib/db.js'
import { getTextGenerationModelInstance, getChatModelInstance } from '../lib/ai-provider.js'
import { buildAiLanguageInstruction } from '../lib/locales.js'
import { resolvePlaylistAiLocale } from '../lib/ai-playlist-generation.js'

const logger = createChildLogger('channels')

/** This is an enhancement on a dialog the user is waiting on — latency beats a second retry. */
const SDK_MAX_RETRIES = 1
/** Titles per request. Small chunks run concurrently, so this is faster AND more reliable than
 *  one long completion, which tends to stop answering partway down a long list. */
const BATCH_SIZE = 8
/** Output budget per title, generous enough that a 25-word answer never truncates. */
const TOKENS_PER_REASON = 110
/** Synopsis context per title: enough to ground the model, small enough to stay cheap. */
const MAX_SYNOPSIS_CHARS = 220
/** Guard against a model that ignores the length instruction. */
const MAX_REASON_CHARS = 260
/** The preference text is user-written and unbounded; it must not swamp the prompt. */
const MAX_PREFERENCES_CHARS = 1200
/** Seed titles are context, not a catalogue. */
const MAX_SEED_TITLES = 12

export interface ChannelPickReasonInput {
  /** Aperture id of the movies/series row — the key the returned map is keyed by. */
  itemId: string
  title: string
  year: number | null
  overview: string | null
}

/**
 * A model chosen for prose: the text-generation role first (its whole purpose), then the chat
 * model. Never an embedding or structuring model.
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

/**
 * Parse `<number> | <reason>` lines tolerantly (accepts . ) : - as separators too, and strips
 * stray markdown/quotes). Returns 1-based index → reason.
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

/** The channel's own definition, as the model should see it. */
function buildBrief(channel: {
  name: string
  genre_filters: string[] | null
  text_preferences: string | null
  seedTitles: string[]
}): string {
  const parts = [`LIST NAME: ${channel.name}`]

  if (channel.genre_filters?.length) {
    parts.push(`GENRES: ${channel.genre_filters.join(', ')}`)
  }
  if (channel.text_preferences?.trim()) {
    parts.push(`WHAT THE USER ASKED FOR: ${truncate(channel.text_preferences, MAX_PREFERENCES_CHARS)}`)
  }
  if (channel.seedTitles.length > 0) {
    parts.push(`TITLES THEY PICKED AS THE REFERENCE POINT: ${channel.seedTitles.join(', ')}`)
  }

  return parts.join('\n')
}

function buildPrompt(brief: string, picks: ChannelPickReasonInput[], langBlock: string): string {
  const lines = picks.map((pick, i) => {
    const parts = [`${i + 1}. ${pick.title}`]
    if (pick.year) parts.push(`(${pick.year})`)
    if (pick.overview) parts.push(`— synopsis: ${truncate(pick.overview, MAX_SYNOPSIS_CHARS)}`)
    return parts.join(' ')
  })

  return (
    `${brief}\n\n` +
    'For each numbered title below, write ONE sentence telling the user why it earns a place on that list.\n' +
    'Rules:\n' +
    '- Tie it to the brief: the specific quality, tone, era or technique the list is built around. If the brief names reference titles, say what this shares with them.\n' +
    '- Be concrete and confident. Never hedge or attribute: no "is often described as", "fans of X might enjoy", "is considered".\n' +
    '- Do NOT summarize the plot — the card shows the synopsis next to your note.\n' +
    '- Never invent facts. If you know little about a title, say what the synopsis and the brief have in common and stop there.\n' +
    '- Around 20-30 words. No title, no markdown, no bullet points.\n\n' +
    'Reply with exactly one line per title in the form `<number> | <your sentence>` and nothing else.\n\n' +
    lines.join('\n') +
    langBlock
  )
}

function chunkBy<T>(list: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size))
  return chunks
}

/** One pick plus its position in the caller's list, so chunks can be reassembled. */
interface IndexedPick {
  index: number
  pick: ChannelPickReasonInput
}

async function writeChunk(
  model: LanguageModel,
  brief: string,
  langBlock: string,
  chunk: IndexedPick[]
): Promise<Array<{ index: number; reason: string }>> {
  const { text } = await generateText({
    model,
    maxRetries: SDK_MAX_RETRIES,
    maxOutputTokens: chunk.length * TOKENS_PER_REASON + 200,
    prompt: buildPrompt(
      brief,
      chunk.map((entry) => entry.pick),
      langBlock
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

/**
 * Write a one-line rationale for each pick, keyed by Aperture item id.
 *
 * Returns an empty map rather than throwing when no writing model is configured or the provider
 * fails: the preview is still perfectly usable without notes, and a failed generate here would
 * cost the user the whole list.
 *
 * Seeds should NOT be passed in — the user chose those by hand and the UI already marks them, so
 * asking a model to justify them spends tokens on "you picked this".
 */
export async function generateChannelPickReasons(
  channelId: string,
  picks: ChannelPickReasonInput[]
): Promise<Map<string, string>> {
  const reasons = new Map<string, string>()
  if (picks.length === 0) return reasons

  const channel = await queryOne<{
    owner_id: string
    name: string
    genre_filters: string[] | null
    text_preferences: string | null
    example_movie_ids: string[] | null
    example_series_ids: string[] | null
  }>(
    `SELECT owner_id, name, genre_filters, text_preferences, example_movie_ids, example_series_ids
     FROM channels WHERE id = $1`,
    [channelId]
  )

  if (!channel) return reasons

  let model: LanguageModel
  try {
    model = await getWritingModel()
  } catch (err) {
    logger.info({ err, channelId }, 'No writing model configured; preview reasons skipped')
    return reasons
  }

  const seedTitles = await fetchSeedTitles(
    channel.example_movie_ids ?? [],
    channel.example_series_ids ?? []
  )
  const brief = buildBrief({
    name: channel.name,
    genre_filters: channel.genre_filters,
    text_preferences: channel.text_preferences,
    seedTitles,
  })
  const aiLocale = await resolvePlaylistAiLocale(channel.owner_id)
  const langBlock = `\n\n${buildAiLanguageInstruction(aiLocale)}`

  const byIndex = new Map<number, string>()
  let remaining: IndexedPick[] = picks.map((pick, index) => ({ index, pick }))
  let firstError: unknown = null

  // Two passes at most: the second only retries titles the first didn't answer for, so one
  // dropped chunk costs a short extra call rather than the trailing half of the list.
  for (let pass = 0; pass < 2 && remaining.length > 0; pass++) {
    const results = await Promise.all(
      chunkBy(remaining, BATCH_SIZE).map((chunk) =>
        writeChunk(model, brief, langBlock, chunk).catch((err) => {
          firstError ??= err
          return [] as Array<{ index: number; reason: string }>
        })
      )
    )
    for (const { index, reason } of results.flat()) byIndex.set(index, reason)
    remaining = remaining.filter((entry) => !byIndex.has(entry.index))
  }

  if (firstError) {
    logger.warn({ err: firstError, channelId }, 'Preview reason generation partially failed')
  }

  for (const [index, reason] of byIndex) {
    const pick = picks[index]
    if (pick) reasons.set(pick.itemId, reason)
  }

  logger.info(
    { channelId, picks: picks.length, written: reasons.size },
    'Generated preview pick reasons'
  )

  return reasons
}

/** Seed titles, movies then series, capped — they are context for the brief, not a catalogue. */
async function fetchSeedTitles(movieIds: string[], seriesIds: string[]): Promise<string[]> {
  if (movieIds.length === 0 && seriesIds.length === 0) return []

  const result = await query<{ title: string }>(
    `SELECT title FROM movies WHERE id = ANY($1)
     UNION ALL
     SELECT title FROM series WHERE id = ANY($2)`,
    [movieIds, seriesIds]
  )

  return result.rows.slice(0, MAX_SEED_TITLES).map((r) => r.title)
}
