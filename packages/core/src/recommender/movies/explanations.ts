/**
 * AI Explanation Generator
 *
 * Generates personalized explanations using actual embedding-based evidence
 * showing which watched movies are most similar to each recommendation.
 */

import { query } from '../../lib/db.js'
import { createChildLogger } from '../../lib/logger.js'
import { getTextGenerationModelInstance, getFunctionConfig } from '../../lib/ai-provider.js'
import { generateText } from 'ai'
import { buildAiLanguageInstruction, DEFAULT_LOCALE, type AppLocaleCode } from '../../lib/locales.js'
import { resolveEffectiveAiLanguage } from '../../lib/userSettings.js'
import { WATCH_HISTORY_TASTE_SQL } from '../watchedExclusion.js'
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

const logger = createChildLogger('explanations')

/** The configured provider's batch settings. The numbers live in shared/. */
async function getExplanationBatchSize(): Promise<ExplanationBatchSettings> {
  const config = await getFunctionConfig('textGeneration')
  return explanationBatchSettings(config?.provider)
}

export interface MovieForExplanation {
  movieId: string
  title: string
  year: number | null
  genres: string[]
  overview: string | null
  similarity: number
  /**
   * Similarity read against the run's own candidate pool rather than as an
   * absolute cosine. Every comparative claim below uses this: raw cosine within
   * one library sits in a cone (~0.60-0.64 on a live instance), so an absolute
   * threshold either fires for every pick or for none, and "62% match" was
   * printed for the entire list.
   */
  normalizedSimilarity: number
  novelty: number
  ratingScore: number
  /**
   * Set when this pick came from a reserved custom-interest slot rather than
   * from the ranking (recommender/shared/interestSlots.ts). Without it the
   * explanation would justify the film purely on taste similarity, which for
   * an interest pick is exactly the signal that did *not* put it here.
   */
  interestText?: string | null
  /**
   * True when this pick came from a reserved taste-twin slot
   * (recommender/shared/twinSlots.ts). Same reasoning as interestText: what put
   * the film here is that a viewer with demonstrably overlapping taste watched
   * it, not the user's own similarity ranking, so an explanation built on
   * similarity alone would be describing a reason that did not apply.
   *
   * Deliberately a flag and not the donor's name. The panel says "someone with
   * taste like yours", so an identity must not be able to reach the prompt.
   */
  fromTasteTwin?: boolean
  /**
   * Set when the pick holds a reserved acclaimed slot. Same reasoning as the
   * two flags above: the ranking is exactly what did NOT choose this title, so
   * without the marker the model reaches for the similarity evidence and
   * invents a taste connection that was never the reason.
   */
  fromAcclaimed?: boolean
}

export interface EvidenceMovie {
  title: string
  year: number | null
  similarity: number
  evidenceType: 'favorite' | 'highly_rated' | 'watched'
  /**
   * What this film is about. Carried so the model can say what the pick and
   * this share instead of asserting a link from two titles — see
   * shared/explanationPrompt.ts.
   */
  overview: string | null
}

/**
 * The enriched fields that describe a title beyond its genre list. Fetched for
 * the picks themselves; the evidence rows carry their own overview from the
 * evidence query.
 */
interface TitleContext {
  keywords: string[]
  directors: string[]
}

export interface MovieWithEvidence extends MovieForExplanation {
  evidence: EvidenceMovie[]
}

export interface ExplanationResult {
  movieId: string
  explanation: string
}

export interface UserTasteContext {
  topGenres: string[]
  favoriteMovies: { title: string; year: number | null; genres: string[] }[]
  tasteSynopsis: string | null
}

/**
 * Fetch embedding-based evidence for recommendations
 * This shows which watched movies are most similar to each recommendation
 */
async function fetchEvidenceForRecommendations(
  runId: string,
  movieIds: string[]
): Promise<Map<string, EvidenceMovie[]>> {
  const result = await query<{
    movie_id: string
    similar_title: string
    similar_year: number | null
    similar_overview: string | null
    similarity: number
    evidence_type: string
  }>(
    `SELECT
       rc.movie_id,
       m.title as similar_title,
       m.year as similar_year,
       m.overview as similar_overview,
       re.similarity,
       re.evidence_type
     FROM recommendation_evidence re
     JOIN recommendation_candidates rc ON rc.id = re.candidate_id
     JOIN movies m ON m.id = re.similar_movie_id
     WHERE rc.run_id = $1 AND rc.movie_id = ANY($2)
     ORDER BY rc.movie_id, re.similarity DESC`,
    [runId, movieIds]
  )

  const evidenceMap = new Map<string, EvidenceMovie[]>()

  for (const row of result.rows) {
    if (!evidenceMap.has(row.movie_id)) {
      evidenceMap.set(row.movie_id, [])
    }
    evidenceMap.get(row.movie_id)!.push({
      title: row.similar_title,
      year: row.similar_year,
      similarity: row.similarity,
      evidenceType: row.evidence_type as 'favorite' | 'highly_rated' | 'watched',
      overview: row.similar_overview,
    })
  }

  return evidenceMap
}

/**
 * Themes and crew for the picks being explained.
 *
 * A separate round trip because the picks arrive from the pipeline (or from the
 * refresh job) as already-scored candidates that carry neither. One query for
 * the whole batch set, not one per title.
 */
async function fetchTitleContext(movieIds: string[]): Promise<Map<string, TitleContext>> {
  if (movieIds.length === 0) return new Map()

  const result = await query<{
    id: string
    keywords: string[] | null
    directors: string[] | null
  }>(`SELECT id, keywords, directors FROM movies WHERE id = ANY($1)`, [movieIds])

  return new Map(
    result.rows.map((row) => [
      row.id,
      { keywords: row.keywords ?? [], directors: row.directors ?? [] },
    ])
  )
}

/**
 * Get rich user taste context
 */
async function getUserTasteContext(userId: string): Promise<UserTasteContext> {
  // Both queries are gated on the taste predicate, the same one the taste
  // vector, the genre familiarity baseline and the series pipeline all use.
  // Ungated they counted every watch_history row, including films abandoned
  // after two minutes — so a genre someone bounced off repeatedly could be
  // presented to the model as one of their favourites.

  // Get top genres by watch frequency
  const genreResult = await query<{ genre: string }>(
    `SELECT unnest(m.genres) as genre, COUNT(*) as count
     FROM watch_history wh
     JOIN movies m ON m.id = wh.movie_id
     WHERE wh.user_id = $1 AND ${WATCH_HISTORY_TASTE_SQL}
     GROUP BY genre
     ORDER BY count DESC
     LIMIT 8`,
    [userId]
  )

  // Get top favorite movies (by play count and favorite flag)
  const favoritesResult = await query<{
    title: string
    year: number | null
    genres: string[]
  }>(
    `SELECT m.title, m.year, m.genres
     FROM watch_history wh
     JOIN movies m ON m.id = wh.movie_id
     WHERE wh.user_id = $1 AND ${WATCH_HISTORY_TASTE_SQL}
     ORDER BY wh.is_favorite DESC, wh.play_count DESC, wh.last_played_at DESC NULLS LAST
     LIMIT 15`,
    [userId]
  )

  // Get taste synopsis if available
  const synopsisResult = await query<{ taste_synopsis: string | null }>(
    `SELECT taste_synopsis FROM user_preferences WHERE user_id = $1`,
    [userId]
  )

  return {
    topGenres: genreResult.rows.map((r) => r.genre),
    favoriteMovies: favoritesResult.rows.map((r) => ({
      title: r.title,
      year: r.year,
      genres: r.genres || [],
    })),
    tasteSynopsis: synopsisResult.rows[0]?.taste_synopsis || null,
  }
}

/**
 * Generate AI explanations using actual embedding evidence
 */
export async function generateExplanations(
  runId: string,
  userId: string,
  recommendations: MovieForExplanation[],
  /**
   * Checked between batches so an admin's Cancel lands within one request
   * rather than at the end of the user. Optional because the single-user paths
   * have no job to cancel; every batch caller passes one.
   */
  shouldCancel?: () => boolean
): Promise<ExplanationResult[]> {
  if (recommendations.length === 0) {
    return []
  }

  logger.info(
    { runId, count: recommendations.length },
    '🤖 Generating AI explanations with embedding evidence'
  )

  const aiLocale = await resolveEffectiveAiLanguage(userId)

  // Fetch the actual embedding-based evidence
  const movieIds = recommendations.map((r) => r.movieId)
  const [evidenceMap, titleContext, tasteContext] = await Promise.all([
    fetchEvidenceForRecommendations(runId, movieIds),
    fetchTitleContext(movieIds),
    getUserTasteContext(userId),
  ])

  // Attach evidence to each recommendation
  const moviesWithEvidence: MovieWithEvidence[] = recommendations.map((r) => ({
    ...r,
    evidence: evidenceMap.get(r.movieId) || [],
  }))

  // Generate explanations in batches - size depends on provider context window
  const { batchSize, maxTokens } = await getExplanationBatchSize()
  logger.info({ batchSize, maxTokens }, 'Using explanation batch settings based on provider')

  const results: ExplanationResult[] = []

  for (let i = 0; i < moviesWithEvidence.length; i += batchSize) {
    if (shouldCancel?.()) {
      logger.info(
        { generated: results.length, expected: moviesWithEvidence.length },
        '🛑 Explanation generation cancelled between batches'
      )
      break
    }
    const batch = moviesWithEvidence.slice(i, i + batchSize)
    const batchResults = await generateBatchExplanations(
      batch,
      tasteContext,
      titleContext,
      maxTokens,
      aiLocale
    )
    results.push(...batchResults)
  }

  logger.info({ generated: results.length }, '✅ AI explanations generated')
  return results
}

async function generateBatchExplanations(
  movies: MovieWithEvidence[],
  tasteContext: UserTasteContext,
  titleContext: Map<string, TitleContext>,
  maxOutputTokens: number = 3000,
  aiLocale: AppLocaleCode = DEFAULT_LOCALE
): Promise<ExplanationResult[]> {
  // Build user context string
  const userContextLines = [
    `Top genres: ${tasteContext.topGenres.join(', ')}`,
    '',
    `Most watched/favorite films:`,
    ...tasteContext.favoriteMovies
      .slice(0, 10)
      .map((m) => `- "${m.title}" (${m.year || 'N/A'}) - ${m.genres.join(', ')}`),
  ]

  if (tasteContext.tasteSynopsis) {
    userContextLines.unshift(`Taste Profile: ${tasteContext.tasteSynopsis}`, '')
  }

  const userContext = userContextLines.join('\n')

  // Build movie list with evidence
  //
  // The similarity percentages that used to sit on each evidence line are gone.
  // They were raw cosines, which inside one library occupy a band roughly 0.04
  // wide — so 74 and 69 are not the meaningfully different numbers they look
  // like, and there is nothing useful a model can do with either except repeat
  // it as though it were a grade. The list is ordered closest-first, which is
  // the only part of that signal it can actually use.
  const movieList = movies
    .map((m, i) => {
      const evidenceStr =
        m.evidence.length > 0
          ? m.evidence
              .map((e) => {
                const typeLabel =
                  e.evidenceType === 'favorite'
                    ? '⭐ a favorite of theirs'
                    : e.evidenceType === 'highly_rated'
                      ? '🔥 rewatched often'
                      : 'watched'
                const plot = clip(e.overview, EVIDENCE_PLOT_CHARS)
                return `      - "${e.title}" (${e.year || 'N/A'}, ${typeLabel})${plot ? `: ${plot}` : ''}`
              })
              .join('\n')
          : '      (none — say so by writing about the film itself, not about a connection)'

      const interestLine = m.interestText
        ? `\n   ✍️ THEY ASKED FOR THIS: picked because they told us they like "${m.interestText}" — lead with that`
        : ''

      const twinLine = m.fromTasteTwin
        ? `\n   👥 A KINDRED VIEWER PICKED THIS: another viewer here whose taste closely overlaps theirs watched it — lead with that, and never name or describe that person`
        : ''

      const acclaimedLine = m.fromAcclaimed
        ? `\n   🏆 WIDELY ACCLAIMED: in the list because of its standing, not because the ranking chose it — lead with what the film is and why it is held in that regard`
        : ''

      const context = titleContext.get(m.movieId)
      const directors = context?.directors?.length
        ? `\n   Director: ${context.directors.slice(0, 3).join(', ')}`
        : ''
      const keywords = context?.keywords?.length
        ? `\n   Themes: ${context.keywords.slice(0, KEYWORD_LIMIT).join(', ')}`
        : ''

      return `${i + 1}. "${m.title}" (${m.year || 'N/A'})
   Genres: ${m.genres.join(', ')}${directors}${keywords}
   Novelty: ${m.novelty > 0.5 ? 'expands taste' : 'familiar'} | Rating: ${m.ratingScore > 0.7 ? 'highly acclaimed' : m.ratingScore > 0.5 ? 'well received' : 'mixed'}${interestLine}${twinLine}${acclaimedLine}
   Plot: ${clip(m.overview, PICK_PLOT_CHARS) ?? 'No overview available'}
   🎯 CLOSEST IN THEIR WATCH HISTORY (nearest first):
${evidenceStr}`
    })
    .join('\n\n')

  const langBlock = `\n\n${buildAiLanguageInstruction(aiLocale)}`

  try {
    const model = await getTextGenerationModelInstance()
    const { text, finishReason } = await generateText({
      model,
      system: `You are an expert film curator writing personalized recommendation explanations. You have access to:
1. The user's taste profile and favorite films
2. For each recommendation, the SPECIFIC watched movies it's most similar to (via AI embedding analysis), with a short synopsis of each

Write compelling 3-4 sentence explanations for each recommendation. Your explanations MUST:
- Reference the SPECIFIC watched movies listed in "CLOSEST IN THEIR WATCH HISTORY" for each recommendation
- Explain what qualities those movies share with the recommendation, drawing on the synopses, themes and crew you have been given
- Be warm and conversational, like a knowledgeable friend
- Be specific rather than superlative. Naming what two films share is more persuasive than praising either one, and never spoil an ending

CRITICAL: Each recommendation shows which of the user's watched movies it's most similar to. USE THAT DATA - don't make up connections to random movies.

CRITICAL: Some of these films will be obscure and you will not recognise them. That is expected. Work only from the data given - the plot summaries, themes, genres and crew above. Do NOT state awards, box office, critical reception, festival history, cultural impact or production trivia unless it appears in the data. If all you have is two plot summaries, connect them on subject, tone and theme, and say nothing about how either was received. An honest sentence about what a film is beats a confident one about what it achieved.

CRITICAL: A few recommendations are marked "THEY ASKED FOR THIS" with an interest the user typed in themselves. For those, open by connecting the film to that interest in the user's own words, then fill in with the similarity evidence. Never justify one of these on viewing-history similarity alone - that is not why it is in the list, and claiming otherwise would be wrong.

CRITICAL: A few recommendations are marked "A KINDRED VIEWER PICKED THIS". Those are in the list because another viewer with strongly overlapping taste watched them, which is a different reason from similarity to the user's own history - say so, and then use the similarity evidence as support. Refer to that person only in general terms ("someone whose taste lines up with yours"). You do not know who they are, so never name them, guess at them, or describe them.

Format: Return JSON with an "explanations" array containing objects with "index" (1-based) and "explanation" fields.

CRITICAL: A few recommendations are marked "WIDELY ACCLAIMED". Those are in the list because the film is very highly rated by a large number of viewers, which is a different reason from similarity to this user's history - do not claim their viewing history led here. Say plainly that it is a landmark they have not seen yet, then use the similarity evidence only as secondary support if it genuinely fits. The no-invention rule above still applies in full: describe what the film IS from the data given, and do not assert specific awards, festival wins, box office or contemporary reception that is not in the data.

CRITICAL: Never write a double quote inside the explanation text. Titles are shown in quotes above for readability, but repeating that in your answer breaks the JSON - write film titles as plain text, or in single quotes.${langBlock}`,
      prompt: `=== USER'S TASTE PROFILE ===
${userContext}

=== RECOMMENDATIONS WITH SIMILARITY EVIDENCE ===
For each movie below, I've included which of the user's watched films it's most similar to based on AI analysis, with a short synopsis of each so you can see what they actually share:

${movieList}

Generate personalized explanations referencing the specific similar movies shown for each recommendation.`,
      temperature: 0.7,
      maxOutputTokens,
    })

    const { byIndex, mode, rejected } = parseExplanationResponse(text)

    // Any response the strict reader would not accept gets a line, not just a
    // short one. The first version warned only on a short batch, which is
    // exactly the condition ten recovered fragments satisfy -- the page was
    // full of half-sentences while the log read `generated: 20`.
    //
    // Token counts are deliberately not repeated here: llm_inference_calls
    // already records them per request, with the reasoning split.
    const warning = describeExplanationBatch({
      mode,
      parsed: byIndex.size,
      rejected,
      expected: movies.length,
      finishReason,
    })
    if (warning) {
      logger.warn(
        {
          mode,
          parsed: byIndex.size,
          rejected,
          expected: movies.length,
          finishReason,
          maxOutputTokens,
          rawTail: text?.slice(-160) ?? null,
        },
        warning
      )
    }

    // 1-based, matching how the prompt numbers them. A missing entry gets the
    // template, so a partial response costs only the items it left out.
    return movies.map((m, i) => ({
      movieId: m.movieId,
      explanation: byIndex.get(i + 1) ?? generateFallbackExplanation(m),
    }))
  } catch (error) {
    // Extract meaningful error information - AI SDK errors don't serialize well
    const errorInfo = {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Unknown',
      cause: error instanceof Error && error.cause ? String(error.cause) : undefined,
    }
    logger.error({ error: errorInfo }, 'Failed to generate explanations')
    return movies.map((m) => ({
      movieId: m.movieId,
      explanation: generateFallbackExplanation(m),
    }))
  }
}

function generateFallbackExplanation(movie: MovieWithEvidence): string {
  // Checked before the evidence branch: for a reserved interest pick the
  // stated interest is the actual reason it's here, so leading with watch
  // history would misattribute it.
  if (movie.interestText) {
    // "one of the closest" rather than "the closest": the slot goes to the
    // best-scoring title among the interest's strongest matches, not to the
    // single closest one, and the wording shouldn't claim more than that.
    return `You told us you like ${movie.interestText.toLowerCase()} — this ${movie.genres[0]?.toLowerCase() || 'film'} pick is one of the closest matches in your library that you haven't seen yet.`
  }

  // Same reasoning one step down: a twin pick is here because a like-minded
  // viewer watched it, so the evidence branch below would credit the wrong
  // thing. Kept deliberately anonymous.
  // Highest precedence of the three: if a title took an acclaimed slot, that
  // is the reason it is here, and the evidence branch below would credit the
  // ranking that declined to pick it.
  if (movie.fromAcclaimed) {
    return `One of the highest-rated ${movie.genres[0]?.toLowerCase() || 'film'}s in your library that you have not seen yet — widely regarded, and still waiting for you.`
  }

  if (movie.fromTasteTwin) {
    return `Someone here whose taste closely overlaps yours watched this ${movie.genres[0]?.toLowerCase() || 'film'} — it's the kind of thing the two of you keep landing on independently.`
  }

  if (movie.evidence.length > 0) {
    const topMatch = movie.evidence[0]
    return `Based on your enjoyment of "${topMatch.title}", this ${movie.genres[0] || 'film'} shares similar qualities you'll likely appreciate.`
  }

  const reasons: string[] = []

  if (movie.normalizedSimilarity > 0.7) {
    reasons.push('strongly matches your viewing history')
  } else if (movie.normalizedSimilarity > 0.5) {
    reasons.push('aligns with your taste')
  }

  if (movie.novelty > 0.5) {
    reasons.push('introduces some fresh genres you might enjoy exploring')
  }

  if (movie.ratingScore > 0.7) {
    reasons.push('is highly acclaimed')
  }

  if (reasons.length === 0) {
    return `This ${movie.genres[0] || 'film'} offers something different from your usual picks.`
  }

  return `This ${movie.genres[0] || 'film'} ${reasons.join(' and ')}.`
}

/**
 * Store explanations in the database
 * OPTIMIZED: Uses bulk UPDATE with unnest() instead of N individual queries
 */
export async function storeExplanations(
  runId: string,
  explanations: ExplanationResult[]
): Promise<void> {
  if (explanations.length === 0) return

  // Bulk UPDATE using unnest and a subquery
  await query(
    `UPDATE recommendation_candidates rc
     SET ai_explanation = t.explanation
     FROM unnest($2::uuid[], $3::text[]) AS t(movie_id, explanation)
     WHERE rc.run_id = $1 AND rc.movie_id = t.movie_id AND rc.is_selected = true`,
    [runId, explanations.map((e) => e.movieId), explanations.map((e) => e.explanation)]
  )

  logger.info({ runId, count: explanations.length }, 'Stored AI explanations')
}

// Legacy export for backwards compatibility - will be removed
export type WatchedMovieForExplanation = {
  title: string
  year: number | null
  genres: string[]
  isFavorite: boolean
}
