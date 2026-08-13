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

const logger = createChildLogger('series-explanations')

/**
 * Get the appropriate batch size based on the text generation provider.
 * Tiered by context window size to avoid hitting limits.
 */
async function getExplanationBatchSize(): Promise<{ batchSize: number; maxTokens: number }> {
  const config = await getFunctionConfig('textGeneration')

  if (!config) {
    // Default conservative settings
    return { batchSize: 3, maxTokens: 1000 }
  }

  // Large context providers: OpenAI (128K), Anthropic (200K), Google (1M+), DeepSeek (64K),
  // OpenRouter (a router in front of those same large-context models)
  const largeContextProviders = ['openai', 'anthropic', 'google', 'deepseek', 'openrouter']
  if (largeContextProviders.includes(config.provider)) {
    return { batchSize: 10, maxTokens: 3000 }
  }

  // Medium context: Groq (8K context)
  if (config.provider === 'groq') {
    return { batchSize: 5, maxTokens: 1500 }
  }

  // Small context: Ollama (default 4K), OpenAI-compatible (varies)
  // Use conservative batch size to fit within limited context windows
  return { batchSize: 3, maxTokens: 1000 }
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
}

export interface EvidenceSeries {
  title: string
  year: number | null
  similarity: number
  evidenceType: 'favorite' | 'highly_rated' | 'watched'
}

export interface SeriesWithEvidence extends SeriesForExplanation {
  evidence: EvidenceSeries[]
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
    similarity: number
    evidence_type: string
  }>(
    `SELECT 
       rc.series_id,
       s.title as similar_title,
       s.year as similar_year,
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
    })
  }

  return evidenceMap
}

/**
 * Get rich user taste context for series
 */
async function getUserSeriesTasteContext(userId: string): Promise<UserSeriesTasteContext> {
  // Get top genres by watch frequency from series watch history
  const genreResult = await query<{ genre: string }>(
    `SELECT unnest(s.genres) as genre, COUNT(*) as count
     FROM watch_history wh
     JOIN episodes e ON e.id = wh.episode_id
     JOIN series s ON s.id = e.series_id
     WHERE wh.user_id = $1 AND wh.media_type = 'episode'
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
     WHERE wh.user_id = $1 AND wh.media_type = 'episode'
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
 * Generate AI explanations for series using actual embedding evidence
 */
export async function generateSeriesExplanations(
  runId: string,
  userId: string,
  recommendations: SeriesForExplanation[]
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
  const evidenceMap = await fetchSeriesEvidenceForRecommendations(runId, seriesIds)

  // Get user taste context
  const tasteContext = await getUserSeriesTasteContext(userId)

  // Attach evidence to each recommendation
  const seriesWithEvidence: SeriesWithEvidence[] = recommendations.map((r) => ({
    ...r,
    evidence: evidenceMap.get(r.seriesId) || [],
  }))

  // Generate explanations in batches - size depends on provider context window
  const { batchSize, maxTokens } = await getExplanationBatchSize()
  logger.info({ batchSize, maxTokens }, 'Using explanation batch settings based on provider')

  const results: SeriesExplanationResult[] = []

  for (let i = 0; i < seriesWithEvidence.length; i += batchSize) {
    const batch = seriesWithEvidence.slice(i, i + batchSize)
    const batchResults = await generateBatchSeriesExplanations(batch, tasteContext, maxTokens, aiLocale)
    results.push(...batchResults)
  }

  logger.info({ generated: results.length }, '✅ Series AI explanations generated')
  return results
}

async function generateBatchSeriesExplanations(
  seriesList: SeriesWithEvidence[],
  tasteContext: UserSeriesTasteContext,
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
  const seriesListStr = seriesList
    .map((s, i) => {
      const evidenceStr =
        s.evidence.length > 0
          ? s.evidence
              .map((e) => {
                const typeLabel =
                  e.evidenceType === 'favorite'
                    ? '⭐ favorite'
                    : e.evidenceType === 'highly_rated'
                      ? '🔥 binged'
                      : 'watched'
                return `"${e.title}" (${(e.similarity * 100).toFixed(0)}% match, ${typeLabel})`
              })
              .join(', ')
          : 'No direct match data'

      const interestLine = s.interestText
        ? `\n   ✍️ THEY ASKED FOR THIS: picked because they told us they like "${s.interestText}" — lead with that`
        : ''

      const twinLine = s.fromTasteTwin
        ? `\n   👥 A KINDRED VIEWER PICKED THIS: another viewer here whose taste closely overlaps theirs watched it — lead with that, and never name or describe that person`
        : ''

      return `${i + 1}. "${s.title}" (${s.year || 'N/A'})
   Genres: ${s.genres.join(', ')}
   ${s.network ? `Network: ${s.network}` : ''}
   ${s.status ? `Status: ${s.status}` : ''}
   Overall match: ${(s.normalizedSimilarity * 100).toFixed(0)}% | Novelty: ${s.novelty > 0.5 ? 'expands taste' : 'familiar'} | Rating: ${s.ratingScore > 0.7 ? 'critically acclaimed' : s.ratingScore > 0.5 ? 'well received' : 'mixed'}${interestLine}${twinLine}
   🎯 SIMILAR TO SERIES THEY'VE WATCHED: ${evidenceStr}
   Plot: ${(s.overview || 'No overview available').substring(0, 250)}...`
    })
    .join('\n\n')

  const langBlock = `\n\n${buildAiLanguageInstruction(aiLocale)}`

  try {
    const model = await getTextGenerationModelInstance()
    const { text } = await generateText({
      model,
      system: `You are an expert TV curator writing personalized recommendation explanations for TV series. You have access to:
1. The user's taste profile and favorite series
2. For each recommendation, the SPECIFIC watched series it's most similar to (via AI embedding analysis)

Write compelling 3-4 sentence explanations for each recommendation. Your explanations MUST:
- Reference the SPECIFIC watched series listed in "SIMILAR TO SERIES THEY'VE WATCHED" for each recommendation
- Explain what qualities those series share with the recommendation (themes, tone, showrunners, network style, etc.)
- Be warm and conversational, like a knowledgeable friend recommending their favorite shows
- Create excitement without spoiling plots
- Mention if it's from a network/streaming service they seem to enjoy

CRITICAL: Each recommendation shows which of the user's watched series it's most similar to. USE THAT DATA - don't make up connections to random series.

CRITICAL: A few recommendations are marked "THEY ASKED FOR THIS" with an interest the user typed in themselves. For those, open by connecting the show to that interest in the user's own words, then fill in with the similarity evidence. Never justify one of these on viewing-history similarity alone - that is not why it is in the list, and claiming otherwise would be wrong.

CRITICAL: A few recommendations are marked "A KINDRED VIEWER PICKED THIS". Those are in the list because another viewer with strongly overlapping taste watched them, which is a different reason from similarity to the user's own history - say so, and then use the similarity evidence as support. Refer to that person only in general terms ("someone whose taste lines up with yours"). You do not know who they are, so never name them, guess at them, or describe them.

Format: Return JSON with an "explanations" array containing objects with "index" (1-based) and "explanation" fields.${langBlock}`,
      prompt: `=== USER'S TV TASTE PROFILE ===
${userContext}

=== RECOMMENDED SERIES WITH SIMILARITY EVIDENCE ===
For each series below, I've included which of the user's watched series it's most similar to based on AI analysis:

${seriesListStr}

Generate personalized explanations referencing the specific similar series shown for each recommendation.`,
      temperature: 0.7,
      maxOutputTokens,
    })

    const content = text
    if (!content) {
      logger.warn('No response from AI for series explanations')
      return seriesList.map((s) => ({
        seriesId: s.seriesId,
        explanation: generateFallbackSeriesExplanation(s),
      }))
    }

    // Parse the JSON response - handle models that wrap in markdown or include preamble
    let jsonContent = content.trim()

    // Extract JSON from markdown code blocks if present
    const jsonBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonBlockMatch) {
      jsonContent = jsonBlockMatch[1].trim()
    }

    // Try to find JSON object/array if there's other text around it
    if (!jsonContent.startsWith('{') && !jsonContent.startsWith('[')) {
      const jsonStart = jsonContent.search(/[[{]/)
      if (jsonStart !== -1) {
        jsonContent = jsonContent.slice(jsonStart)
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonContent)
    } catch (parseError) {
      logger.warn(
        {
          rawResponse: content.substring(0, 500),
          parseError: parseError instanceof Error ? parseError.message : String(parseError),
        },
        'Failed to parse AI response as JSON, using fallbacks'
      )
      return seriesList.map((s) => ({
        seriesId: s.seriesId,
        explanation: generateFallbackSeriesExplanation(s),
      }))
    }
    const explanations = Array.isArray(parsed)
      ? parsed
      : (parsed as { explanations?: unknown[] }).explanations || []

    // Map back to series IDs
    return seriesList.map((s, i) => {
      const found = explanations.find(
        (e: { index: number; explanation: string }) => e.index === i + 1
      )
      return {
        seriesId: s.seriesId,
        explanation: found?.explanation || generateFallbackSeriesExplanation(s),
      }
    })
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
