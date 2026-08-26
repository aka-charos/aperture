/**
 * Discovery Scorer
 * 
 * Scores and ranks discovery candidates using AI similarity and other factors
 */

import { createChildLogger } from '../lib/logger.js'
import { query, queryOne } from '../lib/db.js'
import { getActiveEmbeddingTableName } from '../lib/ai-provider.js'
import type { MediaType, RawCandidate, ScoredCandidate, DiscoveryConfig } from './types.js'
import { getUserFranchisePreferences, getUserTasteClusters } from '../taste-profile/index.js'
import { detectFranchiseFromTitle } from '../taste-profile/franchise.js'
import { applyPreferenceAdjustment } from '../recommender/shared/index.js'

const logger = createChildLogger('discover:scorer')

/**
 * The vectors a discovery candidate gets scored against: the user's taste
 * clusters when they have them, otherwise the single averaged vector this used
 * to be limited to.
 *
 * That average is the "semantic middle" problem multi-centroid profiles exist
 * to fix -- someone who loves both horror and rom-coms averages into a vector
 * that matches neither well -- and discovery is the surface that decides what
 * gets requested from Seerr, so it was the worst place left to still be doing
 * it. Note the legacy read is `user_preferences.taste_embedding`, a different
 * table from `user_taste_profiles`, kept current by storeLegacyTasteProfile.
 *
 * getUserTasteClusters already discards clusters embedded with a model other
 * than the active one, so a stale profile falls through to the legacy vector
 * instead of silently cosine-ing to zero against every candidate.
 */
async function getUserTasteVectors(userId: string, mediaType: MediaType): Promise<number[][]> {
  try {
    const clusters = await getUserTasteClusters(userId, mediaType)
    if (clusters.length > 0) {
      return clusters.map((cluster) => cluster.embedding)
    }
  } catch (err) {
    logger.warn(
      { err, userId, mediaType },
      'Failed to load taste clusters, falling back to the averaged taste vector'
    )
  }

  const embeddingColumn = mediaType === 'movie' ? 'taste_embedding' : 'series_taste_embedding'

  const result = await queryOne<{ embedding: number[] }>(
    `SELECT ${embeddingColumn} as embedding FROM user_preferences WHERE user_id = $1`,
    [userId]
  )
  return result?.embedding ? [result.embedding] : []
}

/**
 * Best cosine similarity between a candidate and any of the user's taste
 * vectors, normalized from [-1,1] to [0,1]. Returns null when there is nothing
 * comparable to score against.
 *
 * MAX -- not average, and not weighted by cluster weight -- mirroring
 * mergeClusterCandidatesByMaxSimilarity and getCustomInterestAffinity: a
 * candidate that strongly matches any one facet of someone's taste is a strong
 * match, and averaging here would recreate the very dilution the clusters were
 * built to avoid. Cluster weight decides how many candidates each facet
 * contributes during retrieval; there is no allocation happening here.
 */
export function maxTasteSimilarity(
  tasteVectors: number[][],
  candidateEmbedding: number[]
): number | null {
  if (tasteVectors.length === 0 || candidateEmbedding.length === 0) return null

  let best: number | null = null
  for (const vector of tasteVectors) {
    // Skip rather than score a dimension mismatch: cosineSimilarity returns 0
    // for one, which would read as a genuine "no match" and could beat a real
    // negative similarity from a usable vector.
    if (vector.length !== candidateEmbedding.length) continue

    const similarity = cosineSimilarity(vector, candidateEmbedding)
    if (best === null || similarity > best) best = similarity
  }

  return best === null ? null : (best + 1) / 2
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dotProduct / magnitude
}

/**
 * Normalize a value to 0-1 range using min-max scaling
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

/**
 * Calculate popularity score (0-1)
 */
function calculatePopularityScore(candidate: RawCandidate, allCandidates: RawCandidate[]): number {
  const popularities = allCandidates.map(c => c.popularity)
  const maxPopularity = Math.max(...popularities, 1)
  const minPopularity = Math.min(...popularities)
  
  return normalize(candidate.popularity, minPopularity, maxPopularity)
}

/**
 * Calculate recency score (0-1) - newer content gets higher scores
 */
function calculateRecencyScore(candidate: RawCandidate): number {
  if (!candidate.releaseYear) return 0.5
  
  const currentYear = new Date().getFullYear()
  const age = currentYear - candidate.releaseYear
  
  // 0 years old = 1.0, 10+ years old = 0.0
  return Math.max(0, Math.min(1, 1 - (age / 10)))
}

/**
 * Calculate source score (0-1) based on source reliability/relevance
 */
function calculateSourceScore(candidate: RawCandidate): number {
  // Prioritize personalized sources over general ones
  const sourceScores: Record<string, number> = {
    'trakt_recommendations': 1.0, // Most personalized
    'tmdb_recommendations': 0.9, // Based on user's watched
    'tmdb_similar': 0.85, // Based on user's ratings
    'trakt_trending': 0.7, // Current popularity
    'trakt_popular': 0.6, // All-time popularity
    'tmdb_discover': 0.5, // General popularity
    'mdblist': 0.6, // Curated lists
  }
  
  return sourceScores[candidate.source] ?? 0.5
}

/**
 * Score candidates based on similarity to user's taste and other factors
 */
export async function scoreCandidates(
  userId: string,
  mediaType: MediaType,
  candidates: RawCandidate[],
  config: DiscoveryConfig
): Promise<ScoredCandidate[]> {
  if (candidates.length === 0) {
    return []
  }

  logger.info({ userId, mediaType, candidateCount: candidates.length }, 'Scoring candidates')

  // Get the user's taste vectors (one per cluster, or the legacy average)
  const tasteVectors = await getUserTasteVectors(userId, mediaType)

  // Get embeddings for candidates that are in our database
  const embeddingTable = await getActiveEmbeddingTableName(mediaType === 'movie' ? 'embeddings' : 'series_embeddings')
  const mediaTable = mediaType === 'movie' ? 'movies' : 'series'
  
  // Build a map of TMDb ID -> embedding for candidates we have in DB
  const tmdbIds = candidates.map(c => c.tmdbId.toString())
  
  const embeddingMap = new Map<number, number[]>()
  
  if (tasteVectors.length > 0 && tmdbIds.length > 0) {
    try {
      const embeddingResult = await query<{ tmdb_id: string; embedding: number[] }>(
        `SELECT m.tmdb_id, e.embedding 
         FROM ${mediaTable} m
         JOIN ${embeddingTable} e ON e.${mediaType === 'movie' ? 'movie_id' : 'series_id'} = m.id
         WHERE m.tmdb_id = ANY($1::text[])`,
        [tmdbIds]
      )
      
      for (const row of embeddingResult.rows) {
        const id = parseInt(row.tmdb_id, 10)
        if (!isNaN(id)) {
          embeddingMap.set(id, row.embedding)
        }
      }
      
      logger.debug({
        mediaType,
        candidateCount: candidates.length,
        embeddingsFound: embeddingMap.size,
        tasteVectors: tasteVectors.length,
      }, 'Loaded embeddings for candidates')
    } catch (err) {
      logger.warn({ err }, 'Failed to load embeddings for candidates')
    }
  }

  // Get user's franchise preferences for boosting
  // Note: Genre weights are not applied here since discovery uses TMDb genre IDs, not names
  const franchisePrefs = await getUserFranchisePreferences(userId, mediaType)
  
  // Build franchise lookup map
  const franchiseScoreMap = new Map<string, number>()
  for (const pref of franchisePrefs) {
    franchiseScoreMap.set(pref.franchiseName.toLowerCase(), pref.preferenceScore)
  }

  // Score each candidate
  const scoredCandidates: ScoredCandidate[] = candidates.map(candidate => {
    // Calculate similarity score against the user's best-matching taste facet
    let similarityScore = 0.5 // Default if no embedding available
    const candidateEmbedding = embeddingMap.get(candidate.tmdbId)
    if (candidateEmbedding) {
      similarityScore = maxTasteSimilarity(tasteVectors, candidateEmbedding) ?? 0.5
    }

    const popularityScore = calculatePopularityScore(candidate, candidates)
    const recencyScore = calculateRecencyScore(candidate)
    const sourceScore = calculateSourceScore(candidate)

    // Calculate base score as a true weighted average (normalized by total
    // weight, including the flat 0.1 source-quality term) so it's always
    // bounded to [0,1] rather than able to run past 1.0 (0.5+0.3+0.2+0.1=1.1
    // if taken as a raw weighted sum).
    const sourceTermWeight = 0.1
    const totalWeight =
      config.similarityWeight + config.popularityWeight + config.recencyWeight + sourceTermWeight
    // DiscoveryConfig weights are currently fixed defaults (never exposed
    // through a settings API), so totalWeight <= 0 can't happen today — but
    // guard it anyway rather than assume that stays true.
    const baseScore =
      totalWeight <= 0
        ? (similarityScore + popularityScore + recencyScore + sourceScore) / 4
        : (similarityScore * config.similarityWeight +
            popularityScore * config.popularityWeight +
            recencyScore * config.recencyWeight +
            sourceScore * sourceTermWeight) /
          totalWeight

    // Apply franchise preference as a bounded nudge (not a raw multiplier —
    // see applyPreferenceAdjustment) so a loved franchise can't push the
    // score past 100%. Genre/interest dimensions aren't tracked here
    // (discovery candidates carry TMDb genre IDs, not names), so they're
    // passed as neutral no-ops.
    let franchiseAffinity = 0.5
    const detectedFranchise = detectFranchiseFromTitle(candidate.title)
    if (detectedFranchise) {
      const prefScore = franchiseScoreMap.get(detectedFranchise.toLowerCase())
      if (prefScore !== undefined) {
        // preference_score is stored clamped to -1..1 (see setFranchisePreference)
        franchiseAffinity = 0.5 + prefScore * 0.5
      }
    }

    // No strength argument on purpose: this is the discovery pipeline, which
    // has its own configuration and does not read recommendation_config. It
    // keeps DEFAULT_PREFERENCE_STRENGTH so an admin tuning recommendations
    // cannot silently change what gets requested from Seerr.
    // Era is neutral here for the same reason genre and interest are: this is
    // the discovery pipeline, scoring titles the library does NOT hold. An era
    // affinity is built from what a viewer watched against what they were
    // offered, and neither half of that comparison exists for a title nobody
    // can watch yet.
    const finalScore = applyPreferenceAdjustment(baseScore, {
      franchise: franchiseAffinity,
      genre: 0.5,
      interest: 0.5,
      era: 0.5,
    })

    return {
      ...candidate,
      finalScore,
      similarityScore,
      popularityScore,
      recencyScore,
      sourceScore,
      scoreBreakdown: {
        similarity: similarityScore,
        popularity: popularityScore,
        recency: recencyScore,
        source: sourceScore,
      },
      // isEnriched will be set by the pipeline after lazy enrichment
      isEnriched: false,
    }
  })

  // Sort by final score descending
  scoredCandidates.sort((a, b) => b.finalScore - a.finalScore)

  // Assign ranks (to all candidates, not limited)
  scoredCandidates.forEach((c, i) => {
    (c as ScoredCandidate & { rank: number }).rank = i + 1
  })

  logger.info({
    userId,
    mediaType,
    inputCount: candidates.length,
    outputCount: scoredCandidates.length,
    topScore: scoredCandidates[0]?.finalScore.toFixed(3),
    bottomScore: scoredCandidates[scoredCandidates.length - 1]?.finalScore.toFixed(3),
  }, 'Scored and ranked candidates')

  // Return all scored candidates - limiting is done in the pipeline
  return scoredCandidates
}

