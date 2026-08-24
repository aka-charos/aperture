/**
 * Series AI Explanation Generator
 *
 * Generates personalized explanations for TV series recommendations using
 * actual embedding-based evidence showing which watched series are most
 * similar to each recommendation.
 */

import { query } from '../../lib/db.js'
import { createChildLogger } from '../../lib/logger.js'
import { getTextGenerationModelInstance, getFunctionConfig } from '../../lib/ai-provider.js'
import { generateText } from 'ai'
import {
  buildAiLanguageInstruction,
  DEFAULT_LOCALE,
  type AppLocaleCode,
} from '../../lib/locales.js'
import { resolveEffectiveAiLanguage } from '../../lib/userSettings.js'
import { WATCH_HISTORY_TASTE_SQL } from '../watchedExclusion.js'
import {
  buildEvidenceRules,
  buildSlotLines,
  buildSlotRules,
  evidenceHeading,
  SERIES_NOUNS,
} from '../shared/explanationPrompt.js'
import { hasCausalEvidence } from '../evidenceStrength.js'
import {
  describeExplanationBatch,
  explanationBatchSettings,
  parseExplanationResponse,
  type ExplanationBatchSettings,
} from '../shared/explanationParsing.js'
import {
  EVIDENCE_PLOT_CHARS,
  KEYWORD_LIMIT,
  PICK_PLOT_CHARS,
  clip,
} from '../shared/explanationPrompt.js'

const logger = createChildLogger('series-explanations')

/** The configured provider's batch settings. The numbers live in shared/. */
async function getExplanationBatchSize(): Promise<ExplanationBatchSettings> {
  const config = await getFunctionConfig('textGeneration')
  return explanationBatchSettings(config?.provider)
}

export interface SeriesForExplanation {
  seriesId: string
  title: string
  year: number | null
  genres: string[]
  overview: string | null
  network: string | null
  status: string | null
  similarity: number
  /**
   * Pool-relative similarity, which is what every comparative claim below
   * reads. Mirrors MovieForExplanation.normalizedSimilarity.
   */
  normalizedSimilarity: number
  novelty: number
  ratingScore: number
  /**
   * Set when this pick came from a reserved custom-interest slot rather than
   * from the ranking (recommender/shared/interestSlots.ts). Mirrors
   * MovieForExplanation.interestText.
   */
  interestText?: string | null
  /**
   * True when this pick came from a reserved taste-twin slot. Mirrors
   * MovieForExplanation.fromTasteTwin, including that it is a flag rather than
   * the donor's identity: the panel says "someone with taste like yours", so a
   * name must not be able to reach the prompt.
   */
  fromTasteTwin?: boolean
  /**
   * Set when the pick holds a reserved acclaimed slot. Mirrors
   * MovieForExplanation.fromAcclaimed: the ranking is exactly what did NOT
   * choose this title, so without the marker the model invents a taste
   * connection that was never the reason.
   */
  fromAcclaimed?: boolean
  /**
   * Ids of the titles this viewer and the taste twin have both watched, from
   * score_breakdown.twinMatch.sharedIds. Resolved to titles below, because
   * this -- not the similarity evidence -- is why a borrowed pick is here.
   */
  twinSharedIds?: string[]
}

export interface EvidenceSeries {
  title: string
  year: number | null
  similarity: number
  evidenceType: 'favorite' | 'highly_rated' | 'watched'
  /** See EvidenceMovie.overview — the model needs to know what these shows are. */
  overview: string | null
}

/** Mirrors the movie generator's TitleContext; series carry no director column. */
interface SeriesTitleContext {
  keywords: string[]
}

export interface SeriesWithEvidence extends SeriesForExplanation {
  evidence: EvidenceSeries[]
  /** Resolved from twinSharedIds; absent unless this is a twin pick. */
  twinSharedTitles?: string[]
}

export interface SeriesExplanationResult {
  seriesId: string
  explanation: string
}

export interface UserSeriesTasteContext {
  topGenres: string[]
  favoriteSeries: { title: string; year: number | null; genres: string[]; network: string | null }[]
  tasteSynopsis: string | null
}

/**
 * Fetch embedding-based evidence for series recommendations
 * Shows which watched series are most similar to each recommendation
 */
async function fetchSeriesEvidenceForRecommendations(
  runId: string,
  seriesIds: string[]
): Promise<Map<string, EvidenceSeries[]>> {
  const result = await query<{
    series_id: string
    similar_title: string
    similar_year: number | null
    similar_overview: string | null
    similarity: number
    evidence_type: string
  }>(
    `SELECT
       rc.series_id,
       s.title as similar_title,
       s.year as similar_year,
       s.overview as similar_overview,
       re.similarity,
       re.evidence_type
     FROM recommendation_evidence re
     JOIN recommendation_candidates rc ON rc.id = re.candidate_id
     JOIN series s ON s.id = re.similar_series_id
     WHERE rc.run_id = $1 AND rc.series_id = ANY($2)
     ORDER BY rc.series_id, re.similarity DESC`,
    [runId, seriesIds]
  )

  const evidenceMap = new Map<string, EvidenceSeries[]>()

  for (const row of result.rows) {
    if (!evidenceMap.has(row.series_id)) {
      evidenceMap.set(row.series_id, [])
    }
    evidenceMap.get(row.series_id)!.push({
      title: row.similar_title,
      year: row.similar_year,
      similarity: row.similarity,
      evidenceType: row.evidence_type as 'favorite' | 'highly_rated' | 'watched',
      overview: row.similar_overview,
    })
  }

  return evidenceMap
}

/** Mirrors fetchTitleContext in the movie generator. */
async function fetchSeriesTitleContext(
  seriesIds: string[]
): Promise<Map<string, SeriesTitleContext>> {
  if (seriesIds.length === 0) return new Map()

  const result = await query<{ id: string; keywords: string[] | null }>(
    `SELECT id, keywords FROM series WHERE id = ANY($1)`,
    [seriesIds]
  )

  return new Map(result.rows.map((row) => [row.id, { keywords: row.keywords ?? [] }]))
}

/**
 * Get rich user taste context for series
 */
async function getUserSeriesTasteContext(userId: string): Promise<UserSeriesTasteContext> {
  // Gated on the taste predicate for the same reason the movie generator is:
  // the sync stores a row for any episode with playback position, so an ungated
  // count let shows the viewer sampled and abandoned outrank ones they finished.
  // Matches taste-profile/builder.ts and series/pipeline.ts.

  // Get top genres by watch frequency from series watch history
  const genreResult = await query<{ genre: string }>(
    `SELECT unnest(s.genres) as genre, COUNT(*) as count
     FROM watch_history wh
     JOIN episodes e ON e.id = wh.episode_id
     JOIN series s ON s.id = e.series_id
     WHERE wh.user_id = $1 AND wh.media_type = 'episode' AND ${WATCH_HISTORY_TASTE_SQL}
     GROUP BY genre
     ORDER BY count DESC
     LIMIT 8`,
    [userId]
  )

  // Get top favorite series (by episodes watched and engagement)
  const favoritesResult = await query<{
    title: string
    year: number | null
    genres: string[]
    network: string | null
  }>(
    `SELECT s.title, s.year, s.genres, s.network,
            COUNT(wh.id) as episodes_watched
     FROM watch_history wh
     JOIN episodes e ON e.id = wh.episode_id
     JOIN series s ON s.id = e.series_id
     WHERE wh.user_id = $1 AND wh.media_type = 'episode' AND ${WATCH_HISTORY_TASTE_SQL}
     GROUP BY s.id, s.title, s.year, s.genres, s.network
     ORDER BY episodes_watched DESC, MAX(wh.last_played_at) DESC NULLS LAST
     LIMIT 15`,
    [userId]
  )

  // Get series taste synopsis if available
  const synopsisResult = await query<{ series_taste_synopsis: string | null }>(
    `SELECT series_taste_synopsis FROM user_preferences WHERE user_id = $1`,
    [userId]
  )

  return {
    topGenres: genreResult.rows.map((r) => r.genre),
    favoriteSeries: favoritesResult.rows.map((r) => ({
      title: r.title,
      year: r.year,
      genres: r.genres || [],
      network: r.network,
    })),
    tasteSynopsis: synopsisResult.rows[0]?.series_taste_synopsis || null,
  }
}

/**
 * Resolve the ids a twin pick carries into display titles, in one round trip
 * for the whole batch.
 *
 * These are titles out of the READER's own watch history -- the rarest ones
 * they and the donor both watched -- so naming them in the prompt leaks nothing
 * about the other viewer, which the donor id itself would.
 */
async function fetchTwinSharedTitles(
  recommendations: SeriesForExplanation[]
): Promise<Map<string, string[]>> {
  const byPick = new Map<string, string[]>()

  const allIds = new Set<string>()
  for (const rec of recommendations) {
    for (const id of rec.twinSharedIds ?? []) allIds.add(id)
  }
  if (allIds.size === 0) return byPick

  const result = await query<{ id: string; title: string; year: number | null }>(
    `SELECT id, title, year FROM series WHERE id = ANY($1)`,
    [[...allIds]]
  )
  const titleById = new Map(
    result.rows.map((row) => [row.id, row.year ? `${row.title} (${row.year})` : row.title])
  )

  for (const rec of recommendations) {
    const titles = (rec.twinSharedIds ?? [])
      .map((id) => titleById.get(id))
      .filter((title): title is string => Boolean(title))
    if (titles.length > 0) byPick.set(rec.seriesId, titles)
  }

  return byPick
}

/**
 * Generate AI explanations for series using actual embedding evidence
 */
export async function generateSeriesExplanations(
  runId: string,
  userId: string,
  recommendations: SeriesForExplanation[],
  /** See the movie generator: checked between batches so Cancel lands quickly. */
  shouldCancel?: () => boolean
): Promise<SeriesExplanationResult[]> {
  if (recommendations.length === 0) {
    return []
  }

  logger.info(
    { runId, count: recommendations.length },
    '🤖 Generating AI explanations for series with embedding evidence'
  )

  const aiLocale = await resolveEffectiveAiLanguage(userId)

  // Fetch the actual embedding-based evidence
  const seriesIds = recommendations.map((r) => r.seriesId)
  const [evidenceMap, titleContext, tasteContext, twinSharedTitles] = await Promise.all([
    fetchSeriesEvidenceForRecommendations(runId, seriesIds),
    fetchSeriesTitleContext(seriesIds),
    getUserSeriesTasteContext(userId),
    fetchTwinSharedTitles(recommendations),
  ])

  // Attach evidence to each recommendation
  const seriesWithEvidence: SeriesWithEvidence[] = recommendations.map((r) => ({
    ...r,
    evidence: evidenceMap.get(r.seriesId) || [],
    twinSharedTitles: twinSharedTitles.get(r.seriesId),
  }))

  // Generate explanations in batches - size depends on provider context window
  const { batchSize, maxTokens } = await getExplanationBatchSize()
  logger.info({ batchSize, maxTokens }, 'Using explanation batch settings based on provider')

  const results: SeriesExplanationResult[] = []

  for (let i = 0; i < seriesWithEvidence.length; i += batchSize) {
    if (shouldCancel?.()) {
      logger.info(
        { generated: results.length, expected: seriesWithEvidence.length },
        '🛑 Series explanation generation cancelled between batches'
      )
      break
    }
    const batch = seriesWithEvidence.slice(i, i + batchSize)
    const batchResults = await generateBatchSeriesExplanations(
      batch,
      tasteContext,
      titleContext,
      maxTokens,
      aiLocale
    )
    results.push(...batchResults)
  }

  logger.info({ generated: results.length }, '✅ Series AI explanations generated')
  return results
}

async function generateBatchSeriesExplanations(
  seriesList: SeriesWithEvidence[],
  tasteContext: UserSeriesTasteContext,
  titleContext: Map<string, SeriesTitleContext>,
  maxOutputTokens: number = 3000,
  aiLocale: AppLocaleCode = DEFAULT_LOCALE
): Promise<SeriesExplanationResult[]> {
  // Build user context string
  const userContextLines = [
    `Top genres: ${tasteContext.topGenres.join(', ')}`,
    '',
    `Most watched series:`,
    ...tasteContext.favoriteSeries
      .slice(0, 10)
      .map(
        (s) =>
          `- "${s.title}" (${s.year || 'N/A'}) - ${s.genres.join(', ')}${s.network ? ` on ${s.network}` : ''}`
      ),
  ]

  if (tasteContext.tasteSynopsis) {
    userContextLines.unshift(`Taste Profile: ${tasteContext.tasteSynopsis}`, '')
  }

  const userContext = userContextLines.join('\n')

  // Build series list with evidence
  //
  // Mirrors the movie generator, including dropping the raw cosine percentages:
  // they sit in a band a few points wide, so they read as grades while carrying
  // almost no information. Order is the usable part and is preserved.
  const seriesListStr = seriesList
    .map((s, i) => {
      const evidenceStr =
        s.evidence.length > 0
          ? s.evidence
              .map((e) => {
                const typeLabel =
                  e.evidenceType === 'favorite'
                    ? '⭐ a favorite of theirs'
                    : e.evidenceType === 'highly_rated'
                      ? '🔥 binged'
                      : 'watched'
                const plot = clip(e.overview, EVIDENCE_PLOT_CHARS)
                return `      - "${e.title}" (${e.year || 'N/A'}, ${typeLabel})${plot ? `: ${plot}` : ''}`
              })
              .join('\n')
          : '      (none — say so by writing about the show itself, not about a connection)'

      // Shared with the movie generator; see explanationPrompt.ts.
      const slotLines = buildSlotLines(s, SERIES_NOUNS)

      const keywords = titleContext.get(s.seriesId)?.keywords
      const themes = keywords?.length
        ? `\n   Themes: ${keywords.slice(0, KEYWORD_LIMIT).join(', ')}`
        : ''

      return `${i + 1}. "${s.title}" (${s.year || 'N/A'})
   Genres: ${s.genres.join(', ')}${s.network ? `\n   Network: ${s.network}` : ''}${s.status ? `\n   Status: ${s.status}` : ''}${themes}
   Novelty: ${s.novelty > 0.5 ? 'expands taste' : 'familiar'} | Rating: ${s.ratingScore > 0.7 ? 'critically acclaimed' : s.ratingScore > 0.5 ? 'well received' : 'mixed'}${slotLines}
   Plot: ${clip(s.overview, PICK_PLOT_CHARS) ?? 'No overview available'}
${evidenceHeading(s, SERIES_NOUNS, hasCausalEvidence(s.evidence.map((e) => e.similarity)))}
${evidenceStr}`
    })
    .join('\n\n')

  const langBlock = `\n\n${buildAiLanguageInstruction(aiLocale)}`

  try {
    const model = await getTextGenerationModelInstance()
    const { text, finishReason } = await generateText({
      model,
      system: `You are an expert TV curator writing personalized recommendation explanations for TV series. You have access to:
1. The user's taste profile and favorite series
2. For each recommendation, the SPECIFIC watched series it's most similar to (via AI embedding analysis), with a short synopsis of each

Write compelling 3-4 sentence explanations for each recommendation. Your explanations MUST:
- Be warm and conversational, like a knowledgeable friend recommending their favorite shows
- Be specific rather than superlative. Naming what two shows share is more persuasive than praising either one, and never spoil an ending
- Mention if it's from a network/streaming service they seem to enjoy
${buildEvidenceRules(SERIES_NOUNS)}

${buildSlotRules(SERIES_NOUNS)}

CRITICAL: Some of these shows will be obscure and you will not recognise them. That is expected. Work only from the data given - the plot summaries, themes, genres and network above. Do NOT state awards, ratings performance, critical reception, cancellation history or production trivia unless it appears in the data. If all you have is two plot summaries, connect them on subject, tone and theme, and say nothing about how either was received. An honest sentence about what a show is beats a confident one about what it achieved.

Format: Return JSON with an "explanations" array containing objects with "index" (1-based) and "explanation" fields.

CRITICAL: Never write a double quote inside the explanation text. Titles are shown in quotes above for readability, but repeating that in your answer breaks the JSON - write series titles as plain text, or in single quotes.${langBlock}`,
      prompt: `=== USER'S TV TASTE PROFILE ===
${userContext}

=== RECOMMENDED SERIES WITH SIMILARITY EVIDENCE ===
For each series below, I've included which of the user's watched series it's most similar to based on AI analysis, with a short synopsis of each so you can see what they actually share:

${seriesListStr}

Generate personalized explanations referencing the specific similar series shown for each recommendation.`,
      temperature: 0.7,
      maxOutputTokens,
    })

    const { byIndex, mode, rejected } = parseExplanationResponse(text)

    // Mirrors the movie generator: see the note there for why any response the
    // strict reader rejected is worth a line, not only a short one.
    const warning = describeExplanationBatch({
      mode,
      parsed: byIndex.size,
      rejected,
      expected: seriesList.length,
      finishReason,
    })
    if (warning) {
      logger.warn(
        {
          mode,
          parsed: byIndex.size,
          rejected,
          expected: seriesList.length,
          finishReason,
          maxOutputTokens,
          rawTail: text?.slice(-160) ?? null,
        },
        `Series: ${warning}`
      )
    }

    // 1-based, matching how the prompt numbers them. A missing entry gets the
    // template, so a partial response costs only the items it left out.
    return seriesList.map((s, i) => ({
      seriesId: s.seriesId,
      explanation: byIndex.get(i + 1) ?? generateFallbackSeriesExplanation(s),
    }))
  } catch (error) {
    // Extract meaningful error information - AI SDK errors don't serialize well
    const errorInfo = {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Unknown',
      cause: error instanceof Error && error.cause ? String(error.cause) : undefined,
    }
    logger.error({ error: errorInfo }, 'Failed to generate series explanations')
    return seriesList.map((s) => ({
      seriesId: s.seriesId,
      explanation: generateFallbackSeriesExplanation(s),
    }))
  }
}

function generateFallbackSeriesExplanation(series: SeriesWithEvidence): string {
  // Checked before the evidence branch: for a reserved interest pick the
  // stated interest is the actual reason it's here, so leading with watch
  // history would misattribute it.
  if (series.interestText) {
    // "one of the closest" rather than "the closest": the slot goes to the
    // best-scoring title among the interest's strongest matches, not to the
    // single closest one, and the wording shouldn't claim more than that.
    return `You told us you like ${series.interestText.toLowerCase()} — this ${series.genres[0]?.toLowerCase() || 'series'} pick is one of the closest matches in your library that you haven't started yet.`
  }

  // Same reasoning one step down: a twin pick is here because a like-minded
  // viewer watched it, so the evidence branch below would credit the wrong
  // thing. Kept deliberately anonymous.
  // Highest precedence of the three, for the same reason as movies.
  if (series.fromAcclaimed) {
    return `One of the highest-rated shows in your library that you have not started yet — widely regarded, and still waiting for you.`
  }

  if (series.fromTasteTwin) {
    return `Someone here whose taste closely overlaps yours has been watching this ${series.genres[0]?.toLowerCase() || 'series'} — it's the kind of thing the two of you keep landing on independently.`
  }

  if (series.evidence.length > 0) {
    const topMatch = series.evidence[0]
    return `Based on your enjoyment of "${topMatch.title}", this ${series.genres[0] || 'series'} shares similar qualities you'll likely appreciate.`
  }

  const reasons: string[] = []

  if (series.normalizedSimilarity > 0.7) {
    reasons.push('strongly matches your viewing history')
  } else if (series.normalizedSimilarity > 0.5) {
    reasons.push('aligns with your taste')
  }

  if (series.novelty > 0.5) {
    reasons.push('introduces some fresh genres you might enjoy exploring')
  }

  if (series.ratingScore > 0.7) {
    reasons.push('is critically acclaimed')
  }

  if (reasons.length === 0) {
    return `This ${series.genres[0] || 'series'} offers something different from your usual picks.`
  }

  return `This ${series.genres[0] || 'series'} ${reasons.join(' and ')}.`
}

/**
 * Store series explanations in the database
 * OPTIMIZED: Uses bulk UPDATE with unnest() instead of N individual queries
 */
export async function storeSeriesExplanations(
  runId: string,
  explanations: SeriesExplanationResult[]
): Promise<void> {
  if (explanations.length === 0) return

  // Bulk UPDATE using unnest and a subquery
  await query(
    `UPDATE recommendation_candidates rc
     SET ai_explanation = t.explanation
     FROM unnest($2::uuid[], $3::text[]) AS t(series_id, explanation)
     WHERE rc.run_id = $1 AND rc.series_id = t.series_id AND rc.is_selected = true`,
    [runId, explanations.map((e) => e.seriesId), explanations.map((e) => e.explanation)]
  )

  logger.info({ runId, count: explanations.length }, 'Stored series AI explanations')
}
