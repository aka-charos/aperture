import type { Candidate, PipelineConfig } from '../types.js'
import {
  calculateRatingScore,
  calculateGenreNoveltyScore,
  buildSimilarityScale,
  normalizeSimilarity,
  calculateBaseScore,
  effectiveBlendWeights,
  spreadOf,
  type BlendWeights,
} from '../shared/index.js'

export interface ScoredPool {
  candidates: Candidate[]
  /**
   * The weights the blend actually used, after correcting each term for how
   * much of the range it uses (see effectiveBlendWeights). These are what
   * finalizeRun stores, because the column means "what this run blended with"
   * and the insights panel multiplies them back out against the component
   * scores -- feeding it the configured weights instead would leave a panel
   * whose arithmetic does not close, which is the fault migration 0147 exists
   * to prevent.
   */
  weights: BlendWeights
}

/**
 * Now synchronous: the genre baseline it used to fetch itself is a per-run
 * constant, so the pipeline resolves it once (see getWatchedGenreCounts) and
 * passes it in. That also removed the `.slice(0, 50)` that silently capped the
 * baseline below whatever recentWatchLimit was set to.
 *
 * Two passes rather than one, because the novelty gain is a property of the
 * pool: it needs every candidate's novelty score before any candidate's final
 * score can be computed. The similarity scale already worked this way.
 */
export function scoreCandidates(
  candidates: Candidate[],
  genreFamiliarity: Map<string, number>,
  config: PipelineConfig
): ScoredPool {
  // Similarity is read against the pool it came from rather than as an absolute
  // cosine, so the configured similarity weight buys the influence it claims.
  // One pass over the pool first, since the scale is a property of the pool.
  const similarityScale = buildSimilarityScale(candidates.map((c) => c.similarity))

  // Pass 1: the three components.
  for (const candidate of candidates) {
    // Use shared rating score calculation (handles bad data, proper scaling)
    candidate.ratingScore = calculateRatingScore(candidate.communityRating)

    // Use shared novelty score calculation (handles missing genres)
    candidate.novelty = calculateGenreNoveltyScore(candidate.genres, genreFamiliarity)

    // Raw similarity stays untouched for evidence, explanations and storage.
    candidate.normalizedSimilarity = normalizeSimilarity(candidate.similarity, similarityScale)
  }

  const weights = effectiveBlendWeights(config, spreadOf(candidates.map((c) => c.novelty)))

  // Pass 2: the blend.
  for (const candidate of candidates) {
    candidate.finalScore = calculateBaseScore(
      candidate.normalizedSimilarity,
      candidate.novelty,
      candidate.ratingScore,
      weights
    )
  }

  // Sort by final score
  candidates.sort((a, b) => b.finalScore - a.finalScore)

  return { candidates, weights }
}
