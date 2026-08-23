/**
 * Series Recommendation Pipeline
 *
 * Generates TV series recommendations for users based on their
 * episode watching history, using both series and episode embeddings.
 */

import { createChildLogger } from '../../lib/logger.js'
import { query, queryOne } from '../../lib/db.js'
import {
  createJobProgress,
  updateJobProgress,
  setJobStep,
  addLog,
  completeJob,
  failJob,
  isJobCancelled,
} from '../../jobs/progress.js'
import { randomUUID } from 'crypto'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../../lib/ai-provider.js'
import { averageEmbeddings } from '../shared/index.js'
import {
  calculateRatingScore,
  buildGenreFamiliarity,
  buildSimilarityScale,
  normalizeSimilarity,
  calculateGenreNoveltyScore,
  calculateBaseScore,
  applyDiversitySelection,
  applyPreferenceAdjustment,
  buildInterestMatchIndex,
  buildTwinIndex,
  computeReservedInterestSlots,
  computeReservedTwinSlots,
  pickInterestSlotFillers,
  pickTwinSlotFillers,
  summarizeScoreComponents,
  EVIDENCE_HISTORY_LIMIT,
  type InterestCandidateMatch,
  type InterestMatchIndex,
  type InterestQueryResult,
  type TwinDonor,
  type TwinIndex,
  effectiveBlendWeights,
  spreadOf,
  type BlendWeights,
} from '../shared/index.js'
import { getDonorWatchedIds, getTwinPairs } from '../twinAffinity.js'
import { getRecommendationConfig } from '../../lib/recommendationConfig.js'
import { storeSeriesEvidence, getSeriesOverviews } from './storage.js'
import {
  generateSeriesExplanations,
  storeSeriesExplanations,
  type SeriesForExplanation,
} from './explanations.js'
import { syncSeriesWatchHistoryForUser } from './sync.js'
import {
  shouldRegenerateRecommendations,
  pruneOldRecommendationRuns,
  RECOMMENDATION_RUNS_TO_KEEP,
} from '../activityGate.js'

// New taste profile system
import {
  completionMultiplier,
  getUserTasteProfile,
  storeTasteProfile as storeNewTasteProfile,
  getUserTasteClusters,
  getFranchiseAffinityMap,
  getUserGenreWeights,
  buildGenreWeightMap,
  genreAffinityFromWeights,
  getUserCustomInterests,
  detectAndUpdateFranchises,
} from '../../taste-profile/index.js'
import { getItemFranchises } from '../../taste-profile/franchise.js'
import { getDislikedSeriesIds } from './taste.js'
import { getWatchedGenreCounts } from '../genreFamiliarity.js'
import { getWatchedYears, summarizeEraFit } from '../eraDiagnostics.js'
import { getEffectiveAiExplanationSetting } from '../../lib/userSettings.js'
import { WATCH_HISTORY_TASTE_SQL } from '../watchedExclusion.js'
import { loadConfigForUser } from '../config.js'
import type { PipelineConfig } from '../types.js'

const logger = createChildLogger('series-recommender')

// Types
export interface SeriesUser {
  id: string
  username: string
  providerUserId: string
  maxParentalRating?: number | null
}

export interface WatchedSeriesData {
  seriesId: string
  episodesWatched: number
  totalEpisodes: number | null
  isFavorite: boolean
  lastPlayedAt: Date | null
  weight: number // Computed engagement weight
}

export interface SeriesCandidate {
  seriesId: string
  id: string // Alias for seriesId - used by shared selection algorithm
  title: string
  year: number | null
  genres: string[]
  network: string | null
  status: string | null
  /** Raw cosine to the taste vector. See BaseCandidate. */
  similarity: number
  /** Pool-relative similarity, which is what the score blend reads. See BaseCandidate. */
  normalizedSimilarity: number
  novelty: number
  ratingScore: number
  diversityBoost: number
  /** Quality match, comparable across every candidate in a run. See BaseCandidate. */
  finalScore: number
  /** The blend before preference affinities moved it. See BaseCandidate. */
  baseScore?: number
  /** Diversity-blended ranking score, selected candidates only. See BaseCandidate. */
  selectionScore?: number
}

// Re-export PipelineConfig as SeriesPipelineConfig for backwards compatibility
export type SeriesPipelineConfig = PipelineConfig

/**
 * Get user's series watch history with engagement weighting
 */
async function getSeriesWatchHistory(userId: string, limit: number): Promise<WatchedSeriesData[]> {
  const result = await query<{
    series_id: string
    episodes_watched: number
    total_episodes: number | null
    has_favorites: boolean
    last_played_at: Date | null
  }>(
    `SELECT 
       e.series_id,
       COUNT(DISTINCT wh.episode_id) as episodes_watched,
       s.total_episodes,
       BOOL_OR(wh.is_favorite) as has_favorites,
       MAX(wh.last_played_at) as last_played_at
     FROM watch_history wh
     JOIN episodes e ON e.id = wh.episode_id
     JOIN series s ON s.id = e.series_id
     WHERE wh.user_id = $1 AND wh.media_type = 'episode' AND (${WATCH_HISTORY_TASTE_SQL})
     GROUP BY e.series_id, s.total_episodes
     ORDER BY MAX(wh.last_played_at) DESC NULLS LAST
     LIMIT $2`,
    [userId, limit]
  )

  return result.rows.map((row) => {
    // Engagement weight, from:
    // 1. Completion rate (how much of the series they watched)
    // 2. Whether they have favorites (strong signal)
    //
    // No recency term here, unlike the taste-profile builder -- this is the
    // fallback single-centroid path and has never had one.
    let weight = 1.0

    // Shared with the builder so both paths agree on what completion is worth,
    // including the penalty for a show that was dropped early.
    if (row.total_episodes && row.total_episodes > 0) {
      weight *= completionMultiplier(row.episodes_watched / row.total_episodes)
    }

    // Favorites bonus (1.5x if they have any favorite episodes)
    if (row.has_favorites) {
      weight *= 1.5
    }

    return {
      seriesId: row.series_id,
      episodesWatched: Number(row.episodes_watched),
      totalEpisodes: row.total_episodes,
      isFavorite: row.has_favorites,
      lastPlayedAt: row.last_played_at,
      weight,
    }
  })
}

/**
 * Build taste profile from watched series
 *
 * Uses a hybrid approach:
 * 1. Series-level embeddings for overall taste
 * 2. Episode-level embeddings for specific interests (optional, for more precision)
 */
async function buildSeriesTasteProfile(
  watchedSeries: WatchedSeriesData[]
): Promise<number[] | null> {
  if (watchedSeries.length === 0) {
    return null
  }

  const model = await getActiveEmbeddingModelId()
  if (!model) {
    logger.warn('No embedding model configured for building series taste profile')
    return null
  }

  // Get the embedding table name
  const tableName = await getActiveEmbeddingTableName('series_embeddings')

  // Get series embeddings
  const seriesIds = watchedSeries.map((w) => w.seriesId)
  const result = await query<{ series_id: string; embedding: string }>(
    `SELECT series_id, embedding::text
     FROM ${tableName}
     WHERE series_id = ANY($1) AND model = $2`,
    [seriesIds, model]
  )

  if (result.rows.length === 0) {
    logger.warn('No series embeddings found for watched series')
    return null
  }

  // Map embeddings by series ID
  const embeddingsMap = new Map<string, number[]>()
  for (const row of result.rows) {
    const embedding = row.embedding.replace(/[[\]]/g, '').split(',').map(Number)
    embeddingsMap.set(row.series_id, embedding)
  }

  // Compute weighted average
  const embeddings: number[][] = []
  const weights: number[] = []

  for (const watched of watchedSeries) {
    const embedding = embeddingsMap.get(watched.seriesId)
    if (embedding) {
      embeddings.push(embedding)
      weights.push(watched.weight)
    }
  }

  if (embeddings.length === 0) {
    return null
  }

  return averageEmbeddings(embeddings, weights)
}

/**
 * Store series taste profile
 */
async function storeSeriesTasteProfile(userId: string, profile: number[]): Promise<void> {
  const vectorStr = `[${profile.join(',')}]`

  await query(
    `INSERT INTO user_preferences (user_id, series_taste_embedding, series_taste_embedding_updated_at)
     VALUES ($1, $2::halfvec, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       series_taste_embedding = $2::halfvec,
       series_taste_embedding_updated_at = NOW(),
       updated_at = NOW()`,
    [userId, vectorStr]
  )
}

interface SeriesCandidateQueryContext {
  model: string
  tableName: string
}

/**
 * Resolves the model/table context shared by every series candidate query.
 * Hoisted out of the per-vector query path so multi-cluster retrieval
 * (getMultiClusterSeriesCandidates) resolves it once, not once per cluster.
 */
async function resolveSeriesCandidateQueryContext(): Promise<SeriesCandidateQueryContext | null> {
  const model = await getActiveEmbeddingModelId()
  if (!model) {
    logger.warn('No embedding model configured for series candidate generation')
    return null
  }
  const tableName = await getActiveEmbeddingTableName('series_embeddings')
  return { model, tableName }
}

/**
 * Runs the actual pgvector ANN query for a single query vector, filters out
 * watched ids, and maps to SeriesCandidate[]. This exact `ORDER BY <=> LIMIT`
 * shape is what lets Postgres use the HNSW index on the embedding table -- a
 * query comparing against multiple vectors at once would not use it (see
 * getMultiClusterSeriesCandidates), so multi-centroid retrieval calls this
 * once per cluster instead of trying to fold multiple vectors into one query.
 */
async function querySeriesCandidatesForVector(
  vectorStr: string,
  limit: number,
  includeWatched: boolean,
  watchedSeriesIds: Set<string>,
  maxParentalRating: number | null,
  ctx: SeriesCandidateQueryContext
): Promise<SeriesCandidate[]> {
  const queryLimit = includeWatched ? limit : limit + watchedSeriesIds.size

  // Build query with optional parental rating filter
  let ratingFilter = ''
  const params: (string | number)[] = [vectorStr, ctx.model, queryLimit]

  if (maxParentalRating !== null) {
    // Map parental rating to content ratings
    // This is a simplified mapping - adjust based on your data
    ratingFilter = `AND (s.content_rating IS NULL OR s.content_rating IN (
      SELECT unnest(CASE
        WHEN $4 >= 18 THEN ARRAY['TV-MA', 'TV-14', 'TV-PG', 'TV-G', 'TV-Y7', 'TV-Y']
        WHEN $4 >= 14 THEN ARRAY['TV-14', 'TV-PG', 'TV-G', 'TV-Y7', 'TV-Y']
        WHEN $4 >= 7 THEN ARRAY['TV-PG', 'TV-G', 'TV-Y7', 'TV-Y']
        ELSE ARRAY['TV-G', 'TV-Y7', 'TV-Y']
      END)
    ))`
    params.push(maxParentalRating)
  }

  const result = await query<{
    series_id: string
    title: string
    year: number | null
    genres: string[]
    network: string | null
    status: string | null
    community_rating: number | null
    similarity: number
  }>(
    `SELECT
       s.id as series_id,
       s.title,
       s.year,
       s.genres,
       s.network,
       s.status,
       s.community_rating,
       1 - (se.embedding <=> $1::halfvec) as similarity
     FROM series s
     JOIN ${ctx.tableName} se ON se.series_id = s.id AND se.model = $2
     WHERE 1=1 ${ratingFilter}
     ORDER BY se.embedding <=> $1::halfvec
     LIMIT $3`,
    params
  )

  // Filter out watched series if not including them
  let candidates = result.rows
  if (!includeWatched) {
    candidates = candidates.filter((c) => !watchedSeriesIds.has(c.series_id))
  }

  // Limit to the requested limit
  candidates = candidates.slice(0, limit)

  return candidates.map((row) => ({
    seriesId: row.series_id,
    id: row.series_id, // Alias for shared selection algorithm
    title: row.title,
    year: row.year,
    genres: row.genres || [],
    network: row.network,
    status: row.status,
    similarity: row.similarity,
    // Filled in by scoreSeriesCandidates, which needs the whole pool to set the scale.
    normalizedSimilarity: 0,
    novelty: 0,
    ratingScore: 0,
    diversityBoost: 0,
    finalScore: 0,
  }))
}

/**
 * Get candidate series based on taste profile
 */
async function getSeriesCandidates(
  tasteProfile: number[],
  watchedSeriesIds: Set<string>,
  maxCandidates: number,
  includeWatched: boolean,
  maxParentalRating: number | null
): Promise<SeriesCandidate[]> {
  const ctx = await resolveSeriesCandidateQueryContext()
  if (!ctx) return []

  const vectorStr = `[${tasteProfile.join(',')}]`
  return querySeriesCandidatesForVector(vectorStr, maxCandidates, includeWatched, watchedSeriesIds, maxParentalRating, ctx)
}

export interface SeriesClusterQueryInput {
  embedding: number[]
  weight: number
}

/**
 * Merge per-cluster candidate result sets, keeping the MAX similarity for any
 * candidate id that appears in more than one cluster's results. Pure -- no DB
 * access -- independently unit-testable. Same MAX-not-average rationale as
 * the movies-side mergeClusterCandidatesByMaxSimilarity
 * (recommender/movies/candidates.ts): a candidate that's a strong match for
 * ANY one of the user's taste facets should score as a strong match.
 */
export function mergeSeriesClusterCandidatesByMaxSimilarity(
  perClusterResults: SeriesCandidate[][]
): SeriesCandidate[] {
  const merged = new Map<string, SeriesCandidate>()

  for (const candidates of perClusterResults) {
    for (const candidate of candidates) {
      const existing = merged.get(candidate.id)
      if (!existing || candidate.similarity > existing.similarity) {
        merged.set(candidate.id, candidate)
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.similarity - a.similarity)
}

/**
 * Multi-centroid candidate retrieval, mirroring
 * recommender/movies/candidates.ts's getMultiClusterCandidates: one indexed
 * ANN query per taste cluster, merged by max similarity. Falls back to the
 * single-vector getSeriesCandidates() when there's only one cluster.
 */
export async function getMultiClusterSeriesCandidates(
  clusters: SeriesClusterQueryInput[],
  watchedSeriesIds: Set<string>,
  totalLimit: number,
  includeWatched: boolean,
  maxParentalRating: number | null
): Promise<SeriesCandidate[]> {
  if (clusters.length === 0) return []
  if (clusters.length === 1) {
    return getSeriesCandidates(clusters[0].embedding, watchedSeriesIds, totalLimit, includeWatched, maxParentalRating)
  }

  const ctx = await resolveSeriesCandidateQueryContext()
  if (!ctx) return []

  const { allocateClusterCandidateLimits } = await import('../shared/index.js')
  const perClusterLimits = allocateClusterCandidateLimits(
    clusters.map((c) => c.weight),
    totalLimit
  )

  const perClusterResults = await Promise.all(
    clusters.map((cluster, i) => {
      const vectorStr = `[${cluster.embedding.join(',')}]`
      return querySeriesCandidatesForVector(
        vectorStr,
        perClusterLimits[i],
        includeWatched,
        watchedSeriesIds,
        maxParentalRating,
        ctx
      )
    })
  )

  return mergeSeriesClusterCandidatesByMaxSimilarity(perClusterResults)
}

/**
 * Custom-interest matching, mirroring recommender/movies/candidates.ts's
 * getInterestMatchIndex -- one indexed ANN query per interest through the same
 * querySeriesCandidatesForVector used for taste retrieval, so no new SQL and
 * the same watched/parental filtering applies. See that function and
 * shared/interestSlots.ts for why interests need this rather than the old
 * per-candidate affinity loop.
 */
export const SERIES_INTEREST_ANN_LIMIT = 1000
export const MAX_QUERIED_SERIES_INTERESTS = 10

export interface SeriesInterestQueryInput {
  interestId: string
  interestText: string
  weight: number
  embedding: number[] | null
  embeddingModel: string | null
}

export async function getSeriesInterestMatchIndex(
  interests: SeriesInterestQueryInput[],
  watchedSeriesIds: Set<string>,
  includeWatched: boolean,
  maxParentalRating: number | null
): Promise<InterestMatchIndex> {
  if (interests.length === 0) return buildInterestMatchIndex([])

  const ctx = await resolveSeriesCandidateQueryContext()
  if (!ctx) return buildInterestMatchIndex([])

  // A stale-dimension embedding makes pgvector raise, and previously just
  // scored 0 forever via cosineSimilarity's length guard. Skip those; they get
  // re-embedded on the next profile rebuild.
  const usable = interests.filter(
    (interest) =>
      interest.embedding && interest.embedding.length > 0 && interest.embeddingModel === ctx.model
  )

  const skipped = interests.length - usable.length
  if (skipped > 0) {
    logger.debug(
      { skipped, activeModel: ctx.model },
      'Skipped custom interests with a missing or stale-model embedding'
    )
  }

  const queried = usable.slice(0, MAX_QUERIED_SERIES_INTERESTS)
  if (queried.length < usable.length) {
    logger.info(
      { total: usable.length, queried: queried.length },
      `Limiting interest matching to the ${MAX_QUERIED_SERIES_INTERESTS} most recent interests`
    )
  }

  const results: InterestQueryResult[] = []

  // Sequential on purpose: the interest count is user-controlled, unlike the
  // fixed K<=3 cluster queries.
  for (const interest of queried) {
    try {
      const vectorStr = `[${interest.embedding!.join(',')}]`
      const rows = await querySeriesCandidatesForVector(
        vectorStr,
        SERIES_INTEREST_ANN_LIMIT,
        includeWatched,
        watchedSeriesIds,
        maxParentalRating,
        ctx
      )

      const tail = rows[rows.length - 1]
      if (
        rows.length >= SERIES_INTEREST_ANN_LIMIT &&
        tail &&
        tail.similarity * interest.weight >= 0.3
      ) {
        logger.debug(
          { interestText: interest.interestText, tailSimilarity: tail.similarity },
          'Interest match list hit its limit while still above the neutral threshold'
        )
      }

      results.push({
        interestId: interest.interestId,
        interestText: interest.interestText,
        weight: interest.weight,
        rows: rows.map((row) => ({ candidateId: row.seriesId, similarity: row.similarity })),
      })
    } catch (err) {
      logger.warn(
        { err, interestId: interest.interestId },
        'Custom interest match query failed, skipping this interest'
      )
    }
  }

  return buildInterestMatchIndex(results)
}

/**
 * Score candidates using multiple factors
 * Uses shared scoring functions for consistency with movie recommendations.
 */
interface ScoredSeriesPool {
  candidates: SeriesCandidate[]
  /** See ScoredPool in movies/scoring.ts -- what the blend actually used. */
  weights: BlendWeights
}

async function scoreSeriesCandidates(
  candidates: SeriesCandidate[],
  genreFamiliarity: Map<string, number>,
  config: SeriesPipelineConfig
): Promise<ScoredSeriesPool> {
  // Get ratings for candidates
  const seriesIds = candidates.map((c) => c.seriesId)
  const ratingsResult = await query<{ id: string; community_rating: number | null }>(
    `SELECT id, community_rating FROM series WHERE id = ANY($1)`,
    [seriesIds]
  )

  const ratingsMap = new Map<string, number | null>()
  for (const row of ratingsResult.rows) {
    ratingsMap.set(row.id, row.community_rating)
  }

  // Similarity is read against the pool it came from rather than as an absolute
  // cosine, so the configured similarity weight buys the influence it claims.
  // Mirrors movies/scoring.ts.
  const similarityScale = buildSimilarityScale(candidates.map((c) => c.similarity))

  // Pass 1: the three components. Two passes rather than one because the
  // novelty gain is a property of the pool -- it needs every candidate's
  // novelty before any candidate's final score can be computed. Mirrors
  // movies/scoring.ts.
  const scored = candidates.map((candidate) => ({
    ...candidate,
    // Use shared rating score calculation (handles bad data, proper scaling)
    ratingScore: calculateRatingScore(ratingsMap.get(candidate.seriesId)),
    // Use shared novelty score calculation (handles missing genres). The genre
    // baseline now comes from the user's whole history rather than the
    // recentWatchLimit slice this used to query for itself.
    novelty: calculateGenreNoveltyScore(candidate.genres, genreFamiliarity),
    // Raw similarity stays untouched for evidence, explanations and storage.
    normalizedSimilarity: normalizeSimilarity(candidate.similarity, similarityScale),
  }))

  const weights = effectiveBlendWeights(config, spreadOf(scored.map((c) => c.novelty)))

  // Pass 2: the blend (bounded weighted average, same formula movies use).
  for (const candidate of scored) {
    candidate.finalScore = calculateBaseScore(
      candidate.normalizedSimilarity,
      candidate.novelty,
      candidate.ratingScore,
      weights
    )
  }

  return { candidates: scored, weights }
}

interface SeriesSelectionResult {
  selected: SeriesCandidate[]
  selectedRanks: Map<string, number>
}

/**
 * Apply diversity boost and select final recommendations
 *
 * Uses the shared diversity selection algorithm which:
 * 1. Preserves original base scores (no compounding)
 * 2. Re-evaluates all candidates at each selection step
 * 3. Properly blends base score with diversity
 * 4. Includes network diversity for TV series
 */
function applySeriesDiversityAndSelect(
  candidates: SeriesCandidate[],
  targetCount: number,
  diversityWeight: number
): SeriesSelectionResult {
  // Use shared diversity selection with network diversity enabled (for TV series)
  const result = applyDiversitySelection(
    candidates,
    targetCount,
    diversityWeight,
    true // Enable network diversity for TV series
  )

  return {
    selected: result.selected,
    selectedRanks: result.selectedRanks,
  }
}

/**
 * Create a series recommendation run record
 */
async function createSeriesRecommendationRun(userId: string): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO recommendation_runs (user_id, media_type, status)
     VALUES ($1, 'series', 'running')
     RETURNING id`,
    [userId]
  )

  return result!.id
}

/**
 * Store series recommendation candidates
 * OPTIMIZED: Uses unnest() for bulk INSERT instead of N individual queries
 */
async function storeSeriesCandidates(
  runId: string,
  candidates: SeriesCandidate[],
  selected: SeriesCandidate[],
  selectedRanks: Map<string, number>,
  interestPicks?: Map<string, InterestCandidateMatch>,
  twinPicks?: Map<string, TwinDonor>
): Promise<void> {
  if (candidates.length === 0) return

  const selectedIds = new Set(selected.map((s) => s.seriesId))

  // Prepare bulk data
  const data = candidates.map((candidate, i) => {
    const isSelected = selectedIds.has(candidate.seriesId)
    const selectedRank = isSelected ? selectedRanks.get(candidate.seriesId) || null : null
    const interestPick = interestPicks?.get(candidate.seriesId)
    const twinPick = twinPicks?.get(candidate.seriesId)

    return {
      seriesId: candidate.seriesId,
      rank: i + 1,
      similarity: candidate.similarity,
      // What the blend consumed, as opposed to the raw cosine beside it. See
      // PreparedCandidateRow in ../storage.ts for why both are kept.
      normalizedSimilarity: candidate.normalizedSimilarity,
      novelty: candidate.novelty,
      ratingScore: candidate.ratingScore,
      // null when the selector never ranked this row, so a slot filler and a
      // scored-but-unpicked title stop reporting a measured-looking 0% variety.
      // See measuredDiversity in ../storage.ts for the full reasoning.
      diversityScore: candidate.selectionScore !== undefined ? candidate.diversityBoost : null,
      finalScore: candidate.finalScore,
      // The blend before preference affinities moved it, so the three stored
      // components can account for final_score exactly.
      baseScore: candidate.baseScore ?? null,
      isSelected,
      selectedRank,
      // null for everything that is neither selected nor an interest pick --
      // the overwhelming majority -- so this stays a cheap array to build even
      // though every scored candidate is stored here. COALESCEd to '{}' below
      // because the column is NOT NULL.
      scoreBreakdown:
        candidate.selectionScore !== undefined || interestPick || twinPick
          ? JSON.stringify({
              // The diversity-blended number the selector ranked by. Kept out
              // of final_score so that column stays one comparable scale for
              // every row; present only on selected candidates.
              ...(candidate.selectionScore !== undefined
                ? { selectionScore: candidate.selectionScore }
                : {}),
              ...(interestPick
                ? {
                    interestMatch: {
                      interestId: interestPick.interestId,
                      interestText: interestPick.interestText,
                      weightedSimilarity: interestPick.weightedSimilarity,
                    },
                  }
                : {}),
              ...(twinPick
                ? {
                    twinMatch: {
                      donorId: twinPick.donorId,
                      affinity: twinPick.affinity,
                      sharedCount: twinPick.sharedCount,
                      ...(twinPick.sharedTopIds?.length
                        ? { sharedIds: twinPick.sharedTopIds }
                        : {}),
                    },
                  }
                : {}),
            })
          : null,
    }
  })

  // Bulk INSERT using unnest
  await query(
    `INSERT INTO recommendation_candidates (
       run_id, series_id, rank, similarity_score, normalized_similarity, novelty_score, rating_score,
       diversity_score, final_score, base_score, is_selected, selected_rank, score_breakdown
     )
     SELECT $1, series_id, rank, similarity_score, normalized_similarity, novelty_score, rating_score,
            diversity_score, final_score, base_score, is_selected, selected_rank,
            -- qualified: score_breakdown is also the name of the target
            -- column, and t. leaves nothing resting on scoping rules
            COALESCE(t.score_breakdown, '{}'::jsonb)
     FROM unnest(
       $2::uuid[], $3::int[], $4::real[], $5::real[], $6::real[], $7::real[],
       $8::real[], $9::real[], $10::real[], $11::boolean[], $12::int[], $13::jsonb[]
     ) AS t(series_id, rank, similarity_score, normalized_similarity, novelty_score, rating_score,
            diversity_score, final_score, base_score, is_selected, selected_rank, score_breakdown)`,
    [
      runId,
      data.map((d) => d.seriesId),
      data.map((d) => d.rank),
      data.map((d) => d.similarity),
      data.map((d) => d.normalizedSimilarity),
      data.map((d) => d.novelty),
      data.map((d) => d.ratingScore),
      data.map((d) => d.diversityScore),
      data.map((d) => d.finalScore),
      data.map((d) => d.baseScore),
      data.map((d) => d.isSelected),
      data.map((d) => d.selectedRank),
      data.map((d) => d.scoreBreakdown),
    ]
  )
}

/**
 * Finalize a series recommendation run
 */
/** Mirrors finalizeRun in the movie pipeline, including the stored weights. */
async function finalizeSeriesRun(
  runId: string,
  candidateCount: number,
  selectedCount: number,
  durationMs: number,
  status: 'completed' | 'failed',
  error?: string,
  weights?: BlendWeights
): Promise<void> {
  await query(
    `UPDATE recommendation_runs
     SET status = $2, candidate_count = $3, selected_count = $4,
         duration_ms = $5, error_message = $6, completed_at = NOW(),
         similarity_weight = $7, novelty_weight = $8, rating_weight = $9
     WHERE id = $1`,
    [
      runId,
      status,
      candidateCount,
      selectedCount,
      durationMs,
      error || null,
      weights?.similarityWeight ?? null,
      weights?.noveltyWeight ?? null,
      weights?.ratingWeight ?? null,
    ]
  )
}

export interface GenerateSeriesRecommendationsOptions {
  /**
   * Skip the whole pipeline when no input has moved since the last completed
   * run. Off by default; only the scheduled all-users job opts in. Mirrors
   * GenerateRecommendationsOptions on the movie side.
   */
  skipIfUnchanged?: boolean
  /**
   * The instance-wide taste-twin index, already thresholded. Built once per
   * batch because the acceptance bar comes from the spread of every pair, so a
   * per-user build would recompute the identical matrix for each viewer.
   */
  twinIndex?: TwinIndex
  /** Mirrors GenerateRecommendationsOptions: see the movie side. */
  shouldCancel?: () => boolean
}

/**
 * Build the series taste-twin index once for a whole batch. Returns an empty
 * index rather than undefined on failure, so a broken query costs one attempt
 * instead of one per user.
 */
async function buildBatchSeriesTwinIndex(): Promise<TwinIndex> {
  try {
    const config = await getRecommendationConfig()
    if (config.series.twinMaxSlots <= 0) return new Map()
    return buildTwinIndex(await getTwinPairs('series'), config.series.twinThresholdK)
  } catch (err) {
    logger.warn({ err }, 'Failed to build the series taste twin index, running without twin slots')
    return new Map()
  }
}

/**
 * Generate series recommendations for a user
 *
 * `runId` is null when the activity gate skipped the user — no run row is
 * written, since the API serves the newest completed run.
 */
export async function generateSeriesRecommendationsForUser(
  user: SeriesUser,
  configOverrides: Partial<SeriesPipelineConfig> = {},
  options: GenerateSeriesRecommendationsOptions = {}
): Promise<{ runId: string | null; recommendations: SeriesCandidate[]; skipped?: boolean }> {
  // Load user-specific config (applies user overrides if enabled, falls back to admin defaults)
  const config = await loadConfigForUser(user.id, 'series')
  const cfg = { ...config, ...configOverrides }
  const startTime = Date.now()

  logger.info(
    { userId: user.id, username: user.username },
    '📺 Starting series recommendation generation'
  )

  // 0. Sync watch history from media server to ensure we have latest data.
  // Ahead of both the activity gate and the run record — see the movie pipeline
  // for why the order matters.
  if (user.providerUserId) {
    logger.info({ userId: user.id }, '🔄 Syncing series watch history before recommendations (full sync)...')
    try {
      // Use full sync to catch any items that may have been missed by delta syncs
      await syncSeriesWatchHistoryForUser(user.id, user.providerUserId, true)
      logger.info({ userId: user.id }, '✅ Series watch history synced')
    } catch (err) {
      logger.warn({ err, userId: user.id }, '⚠️ Series watch history sync failed, continuing with existing data')
    }
  }

  // 0b. Skip entirely when no input has moved since the last completed run.
  if (options.skipIfUnchanged) {
    const decision = await shouldRegenerateRecommendations(user.id, 'series')
    if (!decision.regenerate) {
      logger.info(
        { userId: user.id, username: user.username, lastRunAt: decision.lastRunAt },
        '⏭️ No new activity since last run, keeping existing series recommendations'
      )
      return { runId: null, recommendations: [], skipped: true }
    }
    logger.info(
      { userId: user.id, reason: decision.reason, changedAt: decision.changedAt },
      `🔎 Regenerating: ${decision.reason}`
    )
  }

  const runId = await createSeriesRecommendationRun(user.id)
  logger.info({ runId }, '📝 Created series recommendation run record')

  try {
    // 1. Get user's series watch history (now from synced data)
    logger.info({ userId: user.id }, '📊 Fetching series watch history...')
    const watchedSeries = await getSeriesWatchHistory(user.id, cfg.recentWatchLimit)
    logger.info(
      { userId: user.id, seriesCount: watchedSeries.length },
      `Found ${watchedSeries.length} watched series`
    )

    if (watchedSeries.length === 0) {
      logger.warn(
        { userId: user.id },
        '⚠️ User has no series watch history - cannot generate recommendations'
      )
      // Not 'completed' — see the note at this function's success path.
      await finalizeSeriesRun(
        runId,
        0,
        0,
        Date.now() - startTime,
        'failed',
        'No series watch history for this user'
      )
      return { runId, recommendations: [] }
    }

    // 2. Get or build taste profile using the new persistent system
    logger.info({ userId: user.id }, '🧠 Getting series taste profile...')
    
    // Try to get stored profile first (will rebuild if stale)
    const storedProfile = await getUserTasteProfile(user.id, 'series')
    let tasteProfile: number[] | null = storedProfile?.embedding || null
    
    // If no stored profile or missing embedding, build using legacy method as fallback
    if (!tasteProfile) {
      logger.info({ userId: user.id }, '📊 No stored profile, building from watch history...')
      tasteProfile = await buildSeriesTasteProfile(watchedSeries)
      
      if (tasteProfile) {
        // Get current embedding model to store with profile
        const { getActiveEmbeddingModelId } = await import('../../lib/ai-provider.js')
        const currentModelId = await getActiveEmbeddingModelId()
        
        // Store in new system with embedding model info
        await storeNewTasteProfile(user.id, 'series', tasteProfile, currentModelId || undefined)
        // Also detect franchises
        await detectAndUpdateFranchises(user.id, 'series')
        logger.info({ userId: user.id }, '💾 Stored new taste profile and detected franchises')
      }
    } else {
      logger.info({ userId: user.id }, '✅ Using stored series taste profile')
    }

    if (!tasteProfile) {
      logger.warn(
        { userId: user.id },
        '⚠️ Could not build series taste profile - series may be missing embeddings'
      )
      await finalizeSeriesRun(
        runId,
        0,
        0,
        Date.now() - startTime,
        'failed',
        'Could not build series taste profile (series may be missing embeddings)'
      )
      return { runId, recommendations: [] }
    }

    // Also store in legacy location for backwards compatibility
    await storeSeriesTasteProfile(user.id, tasteProfile)
    logger.info({ userId: user.id }, '💾 Stored series taste profile (legacy)')

    // 3. Get user's preferences for including watched content and handling disliked content
    const userPrefs = await queryOne<{ include_watched: boolean; settings: { dislikeBehavior?: string } | null }>(
      `SELECT include_watched, settings FROM user_preferences WHERE user_id = $1`,
      [user.id]
    )
    const includeWatched = userPrefs?.include_watched ?? false
    const dislikeBehavior = userPrefs?.settings?.dislikeBehavior ?? 'exclude'

    // Get disliked series IDs if dislike_behavior is 'exclude'
    const dislikedIds = dislikeBehavior === 'exclude' 
      ? await getDislikedSeriesIds(user.id) 
      : new Set<string>()
    
    if (dislikedIds.size > 0) {
      logger.info(
        { userId: user.id, dislikedCount: dislikedIds.size },
        `📋 Found ${dislikedIds.size} disliked series to exclude`
      )
    }

    // Get ALL watched series IDs for filtering (not just recent ones used for taste profile)
    // This ensures we exclude ALL series the user has watched, not just the recentWatchLimit
    // Also exclude disliked series if dislike_behavior is 'exclude'
    let excludeIds: Set<string>
    if (includeWatched) {
      // Only exclude disliked series (not watched ones)
      excludeIds = new Set(dislikedIds)
    } else {
      const { getExpandedWatchedSeriesIds, getExpandedFavoritedSeriesIds } = await import(
        '../watchedExclusion.js'
      )
      excludeIds = await getExpandedWatchedSeriesIds(user.id)
      // Favorites stay taste input but stop being offered back as discoveries;
      // see getExpandedFavoritedSeriesIds for why this isn't part of "watched".
      const favoritedIds = await getExpandedFavoritedSeriesIds(user.id)
      for (const favoritedId of favoritedIds) {
        excludeIds.add(favoritedId)
      }
      for (const dislikedId of dislikedIds) {
        excludeIds.add(dislikedId)
      }
      logger.info(
        {
          userId: user.id,
          excludeTotal: excludeIds.size,
          favoritedCount: favoritedIds.size,
          dislikedCount: dislikedIds.size,
        },
        `📋 Loaded ${excludeIds.size} series to exclude (watched duplicates + favorited + disliked)`
      )
    }

    // 4. Get candidate series
    logger.info({ userId: user.id }, '🔍 Finding candidate series...')

    // Multi-centroid retrieval: mirrors movies/pipeline.ts. Falls open to the
    // single-centroid path whenever there's only one cluster, no clusters yet
    // (pre-rebuild), or the multi-cluster query itself fails for any reason.
    const tasteClusters = await getUserTasteClusters(user.id, 'series')

    let candidates: SeriesCandidate[]
    if (tasteClusters.length > 1) {
      try {
        candidates = await getMultiClusterSeriesCandidates(
          tasteClusters.map((c) => ({ embedding: c.embedding, weight: c.weight })),
          excludeIds,
          cfg.maxCandidates,
          includeWatched,
          user.maxParentalRating ?? null
        )
        logger.info(
          { userId: user.id, clusterCount: tasteClusters.length },
          `🧩 Using ${tasteClusters.length} taste clusters for candidate retrieval`
        )
      } catch (err) {
        logger.warn(
          { err, userId: user.id },
          'Multi-cluster candidate retrieval failed, falling back to single-centroid'
        )
        candidates = await getSeriesCandidates(
          tasteProfile,
          excludeIds,
          cfg.maxCandidates,
          includeWatched,
          user.maxParentalRating ?? null
        )
      }
    } else {
      candidates = await getSeriesCandidates(
        tasteProfile,
        excludeIds,
        cfg.maxCandidates,
        includeWatched,
        user.maxParentalRating ?? null
      )
    }

    logger.info(
      { userId: user.id, candidateCount: candidates.length },
      `Found ${candidates.length} candidate series`
    )

    if (candidates.length === 0) {
      logger.warn({ userId: user.id }, '⚠️ No candidate series found')
      await finalizeSeriesRun(
        runId,
        0,
        0,
        Date.now() - startTime,
        'failed',
        'No candidate series found (library may need syncing or embedding)'
      )
      return { runId, recommendations: [] }
    }

    // 5. Score candidates
    logger.info({ userId: user.id }, '📈 Scoring and ranking candidates...')
    // Genre familiarity is a per-run constant, resolved once from the user's
    // whole history rather than the recentWatchLimit slice scoring used to
    // query for itself (see genreFamiliarity.ts).
    const genreFamiliarity = buildGenreFamiliarity(
      await getWatchedGenreCounts(user.id, 'series')
    )

    // See the movie pipeline: these are cfg's weights corrected for how much
    // of its range each term actually uses, and they are what the run records.
    const { candidates: scoredCandidates, weights: blendWeights } = await scoreSeriesCandidates(
      candidates,
      genreFamiliarity,
      cfg
    )

    // 5.5 Apply franchise, genre, and custom interest preference adjustments
    logger.info({ userId: user.id }, '🎯 Applying preference adjustments (franchise, genre, custom interests)...')
    let franchiseSignalCount = 0
    let genreSignalCount = 0
    let interestSignalCount = 0

    // One indexed ANN query per custom interest instead of a per-candidate
    // embedding fetch plus affinity call, so every candidate is measured
    // rather than only the top 100. Fails open to all-neutral affinities.
    let interestIndex: InterestMatchIndex | null = null
    try {
      const customInterests = await getUserCustomInterests(user.id)
      if (customInterests.length > 0) {
        interestIndex = await getSeriesInterestMatchIndex(
          customInterests.map((interest) => ({
            interestId: interest.id,
            interestText: interest.interestText,
            weight: interest.weight,
            embedding: interest.embedding,
            embeddingModel: interest.embeddingModel,
          })),
          excludeIds,
          includeWatched,
          user.maxParentalRating ?? null
        )
      }
    } catch (err) {
      logger.warn({ err, userId: user.id }, 'Custom interest matching failed, continuing without it')
    }

    // Taste twins, mirroring the movie pipeline. The series taste set is not a
    // copy of the movie one: watch_history holds series per *episode*, and a
    // show favorited on the media server leaves no rows at all, so
    // twinAffinity.ts unions user_watching_series. Fails open to no twins.
    let twins: TwinDonor[] = []
    let donorWatched = new Map<string, Set<string>>()
    if (cfg.twinMaxSlots > 0) {
      try {
        const twinIndex =
          options.twinIndex ?? buildTwinIndex(await getTwinPairs('series'), cfg.twinThresholdK)
        twins = twinIndex.get(user.id) ?? []
        if (twins.length > 0) {
          donorWatched = await getDonorWatchedIds(
            twins.map((twin) => twin.donorId),
            'series'
          )
        }
      } catch (err) {
        logger.warn({ err, userId: user.id }, 'Taste twin lookup failed, continuing without it')
      }
    }

    // Franchise and genre preferences are resolved up front rather than inside
    // the loop. Asking per candidate meant 2-3 sequential round trips for every
    // item in the library, and getGenreAffinity re-issued the byte-identical
    // `WHERE user_id = $1` query every single iteration to get back the same
    // handful of rows. Three queries now, and the loop below is pure CPU.
    const [candidateFranchises, franchiseAffinities, genreWeights] = await Promise.all([
      getItemFranchises(
        scoredCandidates.map((candidate) => candidate.seriesId),
        'series'
      ),
      getFranchiseAffinityMap(user.id, 'series'),
      getUserGenreWeights(user.id),
    ])
    const genreWeightMap = buildGenreWeightMap(genreWeights)

    for (const candidate of scoredCandidates) {
      // Franchise affinity: 0 (avoid) - 0.5 (neutral) - 1 (loved)
      const franchiseName = candidateFranchises.get(candidate.seriesId) ?? null
      const franchiseAffinity = franchiseName
        ? franchiseAffinities.get(franchiseName) ?? 0.5
        : 0.5

      // Genre affinity: 0 (avoid) - 0.5 (neutral) - 1 (loved)
      const genreAffinity = genreAffinityFromWeights(genreWeightMap, candidate.genres || [])

      // Custom interest affinity: 0.5 (no match) - 1 (strong match)
      const interestAffinity = interestIndex?.best.get(candidate.seriesId)?.affinity ?? 0.5

      // Nudge the score toward 1 or 0 based on preference affinities, bounded to [0,1]
      //
      // Mirrors the movie pipeline: the pre-nudge value is what the three
      // stored score components blend to, and is kept so the insights panel can
      // show this adjustment rather than leave a gap it cannot account for.
      const originalScore = candidate.finalScore
      candidate.baseScore = originalScore
      candidate.finalScore = applyPreferenceAdjustment(originalScore, {
        franchise: franchiseAffinity,
        genre: genreAffinity,
        interest: interestAffinity,
      })

      if (franchiseAffinity !== 0.5) {
        franchiseSignalCount++
        logger.debug(
          { title: candidate.title, franchiseName, franchiseAffinity: franchiseAffinity.toFixed(2) },
          'Applied franchise preference'
        )
      }
      if (genreAffinity !== 0.5) {
        genreSignalCount++
      }
      if (interestAffinity !== 0.5) {
        interestSignalCount++
        logger.debug(
          { title: candidate.title, interestAffinity: interestAffinity.toFixed(2) },
          'Applied custom interest preference'
        )
      }
    }

    // Re-sort after applying preference adjustments
    scoredCandidates.sort((a, b) => b.finalScore - a.finalScore)

    logger.info(
      { userId: user.id, franchiseSignalCount, genreSignalCount, interestSignalCount },
      `Applied ${franchiseSignalCount} franchise, ${genreSignalCount} genre, ${interestSignalCount} interest preference adjustments`
    )

    // What each scoring term actually contributed to the ordering -- see the
    // matching block in movies/pipeline.ts. `influence` is the number to read.
    logger.info(
      {
        userId: user.id,
        mediaType: 'series',
        genresKnown: genreFamiliarity.size,
        weights: {
          similarity: cfg.similarityWeight,
          novelty: cfg.noveltyWeight,
          rating: cfg.ratingWeight,
        },
        // What the blend really used; `influence` is computed from these, or
        // it would describe a blend that did not happen.
        effectiveWeights: {
          similarity: blendWeights.similarityWeight,
          novelty: blendWeights.noveltyWeight,
          rating: blendWeights.ratingWeight,
        },
        ...summarizeScoreComponents(
          scoredCandidates.map((c) => ({ ...c, id: c.seriesId })),
          blendWeights
        ),
      },
      'SCORE-DIAG'
    )

    // 6. Apply diversity and select
    // Use smart diversity adjustment if user hasn't set custom weights
    const { getSmartDiversityWeight } = await import('../../lib/userAlgorithmSettings.js')
    const effectiveDiversityWeight = await getSmartDiversityWeight(user.id, 'series', cfg.diversityWeight)
    
    logger.info(
      { userId: user.id, targetCount: cfg.selectedCount, diversityWeight: effectiveDiversityWeight },
      '🎲 Applying diversity and selecting...'
    )
    // Reserve a bounded few picks for the user's stated interests -- see
    // shared/interestSlots.ts for why the preference multiplier alone can
    // never surface anything. Zero interests means zero slots.
    const reservedInterestSlots = computeReservedInterestSlots(
      cfg.selectedCount,
      interestIndex?.byInterest.length ?? 0,
      cfg.interestMaxSlots
    )

    // Against what interests left behind, so the two can never over-reserve.
    const reservedTwinSlots = computeReservedTwinSlots(
      cfg.selectedCount - reservedInterestSlots,
      twins.length,
      cfg.twinMaxSlots
    )

    const { selected } = applySeriesDiversityAndSelect(
      scoredCandidates,
      cfg.selectedCount - reservedInterestSlots - reservedTwinSlots,
      effectiveDiversityWeight
    )

    const interestFillers = interestIndex
      ? pickInterestSlotFillers(selected, scoredCandidates, interestIndex, reservedInterestSlots)
      : []

    const interestPicks = new Map<string, InterestCandidateMatch>()
    for (const filler of interestFillers) {
      interestPicks.set(filler.candidate.seriesId, filler.match)
      logger.info(
        { title: filler.candidate.title, interest: filler.match.interestText },
        `⭐ Reserved slot for interest "${filler.match.interestText}": ${filler.candidate.title}`
      )
    }
    if (reservedInterestSlots > interestFillers.length) {
      logger.info(
        { reserved: reservedInterestSlots, filled: interestFillers.length },
        'Some reserved interest slots had no qualifying match and were left unused'
      )
    }

    // After the interest fillers so their picks are already spoken for.
    const twinFillers = pickTwinSlotFillers(
      [...selected, ...interestFillers.map((f) => f.candidate)],
      scoredCandidates,
      twins,
      donorWatched,
      reservedTwinSlots
    )

    const twinPicks = new Map<string, TwinDonor>()
    for (const filler of twinFillers) {
      twinPicks.set(filler.candidate.seriesId, filler.twin)
      logger.info(
        {
          title: filler.candidate.title,
          affinity: filler.twin.affinity,
          shared: filler.twin.sharedCount,
        },
        `👥 Reserved slot for a taste twin: ${filler.candidate.title}`
      )
    }
    if (reservedTwinSlots > twinFillers.length) {
      logger.info(
        { reserved: reservedTwinSlots, filled: twinFillers.length },
        'Some reserved twin slots had no qualifying candidate and were left unused'
      )
    }

    const selectedWithSlots = [
      ...selected,
      ...interestFillers.map((f) => f.candidate),
      ...twinFillers.map((f) => f.candidate),
    ]

    const finalSelected = includeWatched
      ? selectedWithSlots
      : (await import('../watchedExclusion.js')).filterByWatchedIds(
          selectedWithSlots.map((candidate) => ({ ...candidate, id: candidate.seriesId })),
          excludeIds
        )

    if (!includeWatched && finalSelected.length < selectedWithSlots.length) {
      logger.info(
        {
          userId: user.id,
          removed: selectedWithSlots.length - finalSelected.length,
        },
        'Filtered watched series from final recommendations (safety net)'
      )
    }

    const finalSelectedRanks = new Map<string, number>()
    finalSelected.forEach((candidate, index) => {
      finalSelectedRanks.set(candidate.seriesId, index + 1)
    })

    // Log selected series
    logger.info(
      { userId: user.id, selectedCount: finalSelected.length },
      `Selected ${finalSelected.length} series:`
    )
    for (let i = 0; i < Math.min(finalSelected.length, 10); i++) {
      const s = finalSelected[i]
      logger.info(
        { rank: i + 1, title: s.title, year: s.year, score: s.finalScore.toFixed(3) },
        `  ${i + 1}. ${s.title} (${s.year}) - Score: ${s.finalScore.toFixed(3)}`
      )
    }

    // Mirrors the movie pipeline: nothing scores or filters on year, so this
    // reports whether the picks track the user's era anyway. See eraDiagnostics.
    logger.info(
      {
        userId: user.id,
        mediaType: 'series',
        ...summarizeEraFit(
          await getWatchedYears(user.id, 'series'),
          scoredCandidates.map((c) => c.year),
          finalSelected.map((c) => c.year)
        ),
      },
      'ERA-DIAG'
    )

    // 7. Store results
    logger.info({ runId }, '💾 Storing candidates...')
    await storeSeriesCandidates(
      runId,
      scoredCandidates,
      finalSelected,
      finalSelectedRanks,
      interestPicks,
      twinPicks
    )

    // 8. Store evidence (similar watched series for each recommendation)
    logger.info({ runId }, '📊 Storing recommendation evidence...')
    // Mirrors the movie pipeline: `watchedSeries` is capped at recentWatchLimit
    // because it builds a centroid, which is far too narrow a field for a
    // nearest-neighbour lookup the explanation is then written from. See
    // shared/evidencePool.ts.
    const evidencePool = await getSeriesWatchHistory(user.id, EVIDENCE_HISTORY_LIMIT)
    await storeSeriesEvidence(runId, finalSelected, evidencePool)

    // 9. Generate AI explanations for selected recommendations
    //
    // Gated on the same setting that decides whether anyone will ever read them.
    // Without this the run pays for a text-generation call whose only output is
    // a column nothing renders. Turning the setting back on takes effect from
    // the next run: past runs stay unexplained rather than being backfilled.
    if (!(await getEffectiveAiExplanationSetting(user.id))) {
      logger.info({ runId }, '⏭️ AI explanations disabled for this user, skipping generation')
    } else {
      logger.info({ runId }, '🤖 Generating AI explanations...')
      try {
        // Fetch overviews for selected series
        const seriesOverviews = await getSeriesOverviews(finalSelected.map((s) => s.seriesId))

        // Prepare data for explanation generation
        const seriesForExplanation: SeriesForExplanation[] = finalSelected.map((s) => ({
          seriesId: s.seriesId,
          title: s.title,
          year: s.year,
          genres: s.genres,
          overview: seriesOverviews.get(s.seriesId) || null,
          network: s.network,
          status: s.status,
          similarity: s.similarity,
          normalizedSimilarity: s.normalizedSimilarity,
          novelty: s.novelty,
          ratingScore: s.ratingScore,
          // Non-null only for reserved interest slots, so the explanation
          // credits what actually put the show here instead of inventing a
          // watch-history justification for it.
          interestText: interestPicks.get(s.seriesId)?.interestText ?? null,
          // Same idea for a borrowed pick: the reason is a like-minded viewer,
          // not the ranking. A flag, never the donor's identity.
          fromTasteTwin: twinPicks.has(s.seriesId),
        }))

        // Generate explanations using embedding-based evidence
        // Same seam as the movie side: batched paid calls, so Stop lands here.
        const explanations = await generateSeriesExplanations(
          runId,
          user.id,
          seriesForExplanation,
          options.shouldCancel
        )
        await storeSeriesExplanations(runId, explanations)
        logger.info({ runId, count: explanations.length }, '✅ AI explanations stored')
      } catch (explanationError) {
        // Don't fail the whole run if explanations fail
        logger.warn(
          { runId, error: explanationError },
          '⚠️ Failed to generate explanations, continuing without'
        )
      }
    }

    const duration = Date.now() - startTime
    // 'completed' is reserved for a run that actually produced picks, because
    // /api/recommendations serves the newest completed run and nothing else.
    // The early returns above finalize as 'failed' with a reason instead, so a
    // transient condition can't blank every user's page while last week's good
    // picks sit one row further down. Mirrors the movie pipeline.
    await finalizeSeriesRun(
      runId,
      scoredCandidates.length,
      finalSelected.length,
      duration,
      'completed',
      undefined,
      blendWeights
    )

    // Housekeeping, after this run is marked completed so the kept prefix
    // definitely includes it.
    await pruneOldRecommendationRuns(user.id, 'series', RECOMMENDATION_RUNS_TO_KEEP)

    logger.info(
      { userId: user.id, username: user.username, selected: finalSelected.length, duration },
      `🎉 Series recommendations complete: ${finalSelected.length} picks in ${duration}ms`
    )

    return { runId, recommendations: finalSelected }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ userId: user.id, err }, `❌ Series recommendation generation failed: ${error}`)
    await finalizeSeriesRun(runId, 0, 0, Date.now() - startTime, 'failed', error)
    throw err
  }
}

/**
 * Generate series recommendations for all enabled users
 */
/** See generateRecommendationsForAllUsers for why the gate defaults to off. */
export async function generateSeriesRecommendationsForAllUsers(
  jobId?: string,
  options: { skipIfUnchanged?: boolean } = {}
): Promise<{
  success: number
  failed: number
  /** Users left alone because no input had changed since their last run */
  skipped: number
  totalRecommendations: number
  jobId: string
}> {
  const actualJobId = jobId || randomUUID()

  createJobProgress(actualJobId, 'generate-series-recommendations', 2)

  try {
    setJobStep(actualJobId, 0, 'Finding enabled users')
    addLog(actualJobId, 'info', '🔍 Finding enabled users...')

    const result = await query<{
      id: string
      username: string
      provider_user_id: string
      max_parental_rating: number | null
    }>(
      `SELECT id, username, provider_user_id, max_parental_rating FROM users WHERE is_enabled = true AND series_enabled = true AND provider_disabled = false`
    )

    const totalUsers = result.rows.length

    if (totalUsers === 0) {
      addLog(actualJobId, 'warn', '⚠️ No enabled users found')
      completeJob(actualJobId, { success: 0, failed: 0, skipped: 0, totalRecommendations: 0 })
      return { success: 0, failed: 0, skipped: 0, totalRecommendations: 0, jobId: actualJobId }
    }

    addLog(actualJobId, 'info', `👥 Found ${totalUsers} enabled user(s)`)
    setJobStep(actualJobId, 1, 'Generating series recommendations', totalUsers)

    let success = 0
    let failed = 0
    let skipped = 0
    let totalRecommendations = 0

    const twinIndex = await buildBatchSeriesTwinIndex()

    // Cancellation is cooperative -- cancelJob only sets the status and files
    // the job_runs row, so a loop that never asks keeps running to completion.
    // This one is minutes long and every user costs a batch of paid
    // explanation calls, which is how a cancelled run came to keep scoring
    // alongside its own replacement.
    const shouldCancel = () => isJobCancelled(actualJobId)
    let cancelled = false

    for (let i = 0; i < result.rows.length; i++) {
      if (shouldCancel()) {
        cancelled = true
        addLog(actualJobId, 'warn', `⏹️ Cancelled after ${i} of ${totalUsers} user(s)`)
        break
      }

      const user = result.rows[i]

      try {
        addLog(actualJobId, 'info', `📺 Generating series recommendations for ${user.username}...`)

        const recResult = await generateSeriesRecommendationsForUser(
          {
            id: user.id,
            username: user.username,
            providerUserId: user.provider_user_id,
            maxParentalRating: user.max_parental_rating,
          },
          {},
          // Only the scheduled sweep skips; every manual path means someone
          // asked for the work.
          { skipIfUnchanged: options.skipIfUnchanged ?? false, twinIndex, shouldCancel }
        )

        if (recResult.skipped) {
          skipped++
          addLog(actualJobId, 'info', `⏭️ ${user.username}: no new activity, keeping existing picks`)
        } else {
          success++
          totalRecommendations += recResult.recommendations.length
          addLog(
            actualJobId,
            'info',
            `✅ Generated ${recResult.recommendations.length} series recommendations for ${user.username}`
          )
        }
        updateJobProgress(
          actualJobId,
          i + 1,
          totalUsers,
          `${success}/${totalUsers} users (${totalRecommendations} recommendations, ${skipped} unchanged)`
        )
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        logger.error({ err, userId: user.id }, 'Failed to generate series recommendations')
        addLog(actualJobId, 'error', `❌ Failed for ${user.username}: ${error}`)
        failed++
        updateJobProgress(
          actualJobId,
          i + 1,
          totalUsers,
          `${success}/${totalUsers} users (${failed} failed)`
        )
      }
    }

    const finalResult = { success, failed, skipped, totalRecommendations, jobId: actualJobId }
    // A cancelled run must not complete over itself: cancelJob has already
    // filed the job_runs row, and completing on top of a terminal status is
    // ignored with a warning.
    if (!cancelled) completeJob(actualJobId, finalResult)
    addLog(
      actualJobId,
      cancelled ? 'warn' : 'info',
      cancelled
        ? `⏹️ Stopped early: ${success} of ${totalUsers} user(s) done, ${totalRecommendations} recommendations kept`
        : `🎉 Complete: ${success} succeeded, ${failed} failed, ${skipped} unchanged, ${totalRecommendations} total recommendations`
    )

    return finalResult
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    failJob(actualJobId, error)
    throw err
  }
}

/**
 * Clear series recommendations for a user
 */
export async function clearUserSeriesRecommendations(userId: string): Promise<void> {
  await query(`DELETE FROM recommendation_runs WHERE user_id = $1 AND media_type = 'series'`, [
    userId,
  ])
  logger.info({ userId }, 'Cleared series recommendations for user')
}

/**
 * Clear all series recommendations
 */
export async function clearAllSeriesRecommendations(): Promise<void> {
  await query(`DELETE FROM recommendation_runs WHERE media_type = 'series'`)
  logger.info('Cleared all series recommendations')
}

/**
 * Clear and rebuild series recommendations for all users (admin function)
 */
export async function clearAndRebuildAllSeriesRecommendations(existingJobId?: string): Promise<{
  cleared: number
  success: number
  failed: number
  jobId: string
}> {
  const jobId = existingJobId || randomUUID()
  createJobProgress(jobId, 'full-reset-series-recommendations', 3)

  try {
    // Step 1: Count existing
    setJobStep(jobId, 0, 'Counting existing series recommendations')
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) FROM recommendation_runs WHERE media_type = 'series'`
    )
    const existingCount = parseInt(countResult?.count || '0', 10)
    addLog(jobId, 'info', `📊 Found ${existingCount} existing series recommendation runs`)

    // Step 2: Clear all
    setJobStep(jobId, 1, 'Clearing all series recommendations')
    addLog(jobId, 'info', '🗑️ Clearing all series recommendation data...')
    await clearAllSeriesRecommendations()
    addLog(jobId, 'info', '✅ All series recommendations cleared')

    // Step 3: Regenerate for all users
    setJobStep(jobId, 2, 'Regenerating series recommendations')
    const result = await query<{
      id: string
      username: string
      provider_user_id: string
      max_parental_rating: number | null
    }>(
      `SELECT id, username, provider_user_id, max_parental_rating FROM users WHERE is_enabled = true AND series_enabled = true AND provider_disabled = false`
    )
    const users = result.rows
    addLog(jobId, 'info', `👥 Regenerating for ${users.length} enabled user(s)`)

    let success = 0
    let failed = 0

    const twinIndex = await buildBatchSeriesTwinIndex()

    // Cancellation is cooperative -- cancelJob only sets the status and files
    // the job_runs row, so a loop that never asks keeps running to completion.
    // This one is minutes long and every user costs a batch of paid
    // explanation calls, which is how a cancelled run came to keep scoring
    // alongside its own replacement.
    const shouldCancel = () => isJobCancelled(jobId)
    let cancelled = false

    for (let i = 0; i < users.length; i++) {
      if (shouldCancel()) {
        cancelled = true
        addLog(jobId, 'warn', `⏹️ Cancelled after ${i} of ${users.length} user(s)`)
        break
      }

      const user = users[i]
      updateJobProgress(jobId, i, users.length, user.username)

      try {
        addLog(jobId, 'info', `🧠 Generating for ${user.username}...`)
        await generateSeriesRecommendationsForUser(
          {
            id: user.id,
            username: user.username,
            providerUserId: user.provider_user_id,
            maxParentalRating: user.max_parental_rating,
          },
          {},
          { twinIndex, shouldCancel }
        )
        success++
        addLog(jobId, 'info', `✅ Done: ${user.username}`)
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        addLog(jobId, 'error', `❌ ${user.username}: ${error}`)
        failed++
      }
    }

    if (!cancelled) updateJobProgress(jobId, users.length, users.length)
    const finalResult = { cleared: existingCount, success, failed, jobId }
    // A cancelled run must not complete over itself: cancelJob has already
    // filed the job_runs row, and completing on top of a terminal status is
    // ignored with a warning.
    if (!cancelled) completeJob(jobId, finalResult)
    return finalResult
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    addLog(jobId, 'error', `❌ Job failed: ${error}`)
    failJob(jobId, error)
    throw err
  }
}

/**
 * Regenerate series recommendations for a user (user-initiated)
 */
export async function regenerateUserSeriesRecommendations(userId: string): Promise<{
  runId: string
  count: number
}> {
  // Get user info
  const user = await queryOne<{
    id: string
    username: string
    provider_user_id: string
    max_parental_rating: number | null
  }>('SELECT id, username, provider_user_id, max_parental_rating FROM users WHERE id = $1', [
    userId,
  ])

  if (!user) {
    throw new Error('User not found')
  }

  logger.info(
    { userId, username: user.username },
    '🔄 User-initiated series recommendation regeneration'
  )

  // Clear existing series recommendations for this user
  await clearUserSeriesRecommendations(userId)

  // Generate new recommendations
  const result = await generateSeriesRecommendationsForUser({
    id: user.id,
    username: user.username,
    providerUserId: user.provider_user_id,
    maxParentalRating: user.max_parental_rating,
  })

  logger.info(
    { userId, username: user.username, count: result.recommendations.length },
    '✅ Series recommendations regenerated'
  )

  if (!result.runId) {
    // Unreachable: only the activity gate returns a null runId, and this path
    // never opts into it.
    throw new Error('Series recommendation run produced no run id')
  }

  return {
    runId: result.runId,
    count: result.recommendations.length,
  }
}
