/**
 * Writes one Watcher Identity -- film or TV -- streaming it as it arrives.
 *
 * One generator for both media types. The pair it replaces were copies of each
 * other, and the only differences between a film identity and a TV one now live
 * in the evidence (tasteEvidence.ts) and three nouns in the prompt
 * (tasteSynopsisPrompt.ts).
 *
 * Two callers: the SSE route behind Generate Identity, which forwards chunks to a
 * browser, and tasteSynopsisRefresh.ts, which drains it during a recommendation
 * run. It stores the finished text itself, so both share one storage path.
 */

import { streamText } from 'ai'
import { query } from './db.js'
import { createChildLogger } from './logger.js'
import { describeAiError } from './aiErrors.js'
import {
  getReasoningProviderOptions,
  getTextGenerationModelInstance,
  isAIFunctionConfigured,
} from './ai-provider.js'
import { buildAiLanguageInstruction } from './locales.js'
import { resolveEffectiveAiLanguage } from './userSettings.js'
import { gatherTasteEvidence } from './tasteAnalyzer.js'
import {
  MIN_TITLES_FOR_SYNOPSIS,
  formatTasteEvidence,
  rankFacetSkews,
  type TasteEvidence,
  type TasteMediaType,
} from './tasteEvidence.js'
import {
  TASTE_SYNOPSIS_PROMPT_VERSION,
  buildTasteSynopsisSystemPrompt,
} from './tasteSynopsisPrompt.js'

const logger = createChildLogger('taste-synopsis')

/** What a generation did, so a background caller can log it truthfully. */
export type IdentityOutcome = 'written' | 'fallback' | 'too-little-history'

/** Fixed column names, never user input, so interpolating them is safe. */
const COLUMN: Record<TasteMediaType, 'taste_synopsis' | 'series_taste_synopsis'> = {
  movie: 'taste_synopsis',
  series: 'series_taste_synopsis',
}

const NOT_ENOUGH_HISTORY: Record<TasteMediaType, string> = {
  movie: "We're still getting to know you! Watch a few more movies and we'll describe your taste.",
  series:
    "We're still getting to know your TV taste! Watch a few more shows and we'll describe it.",
}

export async function* streamWatcherIdentity(
  userId: string,
  mediaType: TasteMediaType
): AsyncGenerator<string, IdentityOutcome, void> {
  const column = COLUMN[mediaType]
  const evidence = await gatherTasteEvidence(userId, mediaType)

  if (evidence.watchedTotal < MIN_TITLES_FOR_SYNOPSIS[mediaType]) {
    // Clear any identity already stored rather than keep it. Before F-129 an
    // identity counted unwatched favourites as watched films, so a viewer with
    // one played film and sixteen bookmarks held a confident description of a
    // watchlist, fed to their explanations and their assistant. Below the floor
    // there is nothing true to replace it with, and every reader of the column
    // already has a branch for NULL.
    await query(
      `UPDATE user_preferences
          SET ${column} = NULL, ${column}_updated_at = NULL, ${column}_version = NULL
        WHERE user_id = $1 AND ${column} IS NOT NULL`,
      [userId]
    )
    yield NOT_ENOUGH_HISTORY[mediaType]
    return 'too-little-history'
  }

  const evidenceText = formatTasteEvidence(evidence)
  logger.info(
    {
      userId,
      mediaType,
      watched: evidence.watchedTotal,
      rated: evidence.rated.length,
      evidenceChars: evidenceText.length,
    },
    'Writing watcher identity from viewing evidence'
  )
  logger.debug(
    { userId, mediaType, evidencePreview: evidenceText.slice(0, 1200) },
    'Watcher identity evidence'
  )

  if (!(await isAIFunctionConfigured('textGeneration'))) {
    logger.warn({ userId, mediaType }, 'Text generation not configured, storing fallback identity')
    const fallback = buildFallbackIdentity(evidence)
    yield fallback
    await storeIdentity(userId, column, fallback, null)
    return 'fallback'
  }

  let fullText = ''
  let version: number | null = TASTE_SYNOPSIS_PROMPT_VERSION
  // Why a stream ended with no text. Without these the log could only say
  // "no text", which is what version 3 first did in production: the model
  // thought through the whole allowance and stopped before writing a word.
  let reasoningChars = 0
  let finish: { finishReason: string; outputTokens?: number; reasoningTokens?: number } | null =
    null
  try {
    const aiLocale = await resolveEffectiveAiLanguage(userId)
    const model = await getTextGenerationModelInstance()
    const reasoning = await getReasoningProviderOptions('textGeneration')
    const result = streamText({
      model,
      ...(reasoning ? { providerOptions: reasoning } : {}),
      system: `${buildTasteSynopsisSystemPrompt(mediaType)}\n\n${buildAiLanguageInstruction(aiLocale)}`,
      prompt: evidenceText,
      // A factual summary of a record, not writing that benefits from surprise.
      temperature: 0.3,
      // The answer is 200-300 words, but a reasoning model spends this same
      // allowance on its scratchpad before writing a word (F-030). 4000 held for
      // version 2, which asked for a recital; version 3 asks for analysis, and
      // measured live the model thought for 24 seconds, reached the cap and
      // wrote nothing. 16000 is the explanation generators' ceiling on the same
      // role. A cap is not a reservation, so the headroom costs nothing on a
      // model that answers directly.
      maxOutputTokens: 16000,
    })

    // fullStream, not textStream: under AI SDK v5 textStream silently drops
    // "error" chunks, so a failed provider call would yield an empty identity
    // instead of reaching the fallback below.
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        fullText += part.text
        yield part.text
      } else if (part.type === 'reasoning-delta') {
        reasoningChars += part.text.length
      } else if (part.type === 'finish') {
        finish = {
          finishReason: part.finishReason,
          outputTokens: part.totalUsage.outputTokens,
          reasoningTokens: part.totalUsage.reasoningTokens,
        }
      } else if (part.type === 'error') {
        throw part.error instanceof Error ? part.error : new Error(String(part.error))
      }
    }
  } catch (error) {
    logger.error({ ...describeAiError(error), userId, mediaType }, 'Failed to stream watcher identity')
    const fallback = buildFallbackIdentity(evidence)
    yield fallback
    fullText = fallback
    // Stored with no version, so the next refresh retries rather than letting
    // one transient provider failure stand in for the identity until the
    // profile next moves.
    version = null
  }

  // An empty generation is not a result, and must never reach the store. The
  // stream can finish cleanly with no text-delta at all -- a reasoning model can
  // spend the whole cap thinking and stop -- and '' stored is indistinguishable
  // from never generated, so a good identity would be replaced by a card
  // offering Generate Identity (F-110). Throwing reaches the client as an SSE
  // error part and leaves the stored identity on screen.
  if (!fullText.trim()) {
    logger.warn(
      { userId, mediaType, ...finish, reasoningChars },
      'Identity generation produced no text; keeping the stored one'
    )
    throw new Error(
      finish?.finishReason === 'length'
        ? 'The model spent its whole output allowance before writing; nothing was changed'
        : 'The model returned an empty taste profile; nothing was changed'
    )
  }

  await storeIdentity(userId, column, fullText, version)
  logger.info({ userId, mediaType, chars: fullText.length, version }, 'Watcher identity stored')
  return version == null ? 'fallback' : 'written'
}

async function storeIdentity(
  userId: string,
  column: 'taste_synopsis' | 'series_taste_synopsis',
  text: string,
  version: number | null
): Promise<void> {
  await query(
    `INSERT INTO user_preferences (user_id, ${column}, ${column}_updated_at, ${column}_version)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (user_id) DO UPDATE
       SET ${column} = $2, ${column}_updated_at = NOW(), ${column}_version = $3`,
    [userId, text, version]
  )
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * What is stored when no model can write the identity. Built from the same
 * evidence, so it makes the same kind of claim -- a skew against the library --
 * rather than the old blurb's "your top genres are", which named volume.
 */
function buildFallbackIdentity(evidence: TasteEvidence): string {
  const noun = evidence.mediaType === 'movie' ? 'movies' : 'shows'
  const watched = `${evidence.watchedTotal.toLocaleString('en-US')} ${noun}`
  const totals = evidence.facetTotals.genre
  const preferred = totals
    ? rankFacetSkews('genre', evidence.facets, totals)
        .over.slice(0, 3)
        .map((s) => s.label)
    : []

  const lead =
    preferred.length > 0
      ? `Across the ${watched} you've watched, you pick ${joinList(preferred)} more often than your library offers them.`
      : `Across the ${watched} you've watched, no genre stands out from your library's own mix.`

  return `${lead} A fuller description couldn't be written this time.`
}
