import type { Candidate, PipelineConfig } from '../types.js'
import {
  calculateRatingScore,
  calculateGenreNoveltyScore,
  buildSimilarityScale,
  normalizeSimilarity,
  calculateBaseScore,
} from '../shared/index.js'

/**
 * Now synchronous: the genre baseline it used to fetch itself is a per-run
 * constant, so the pipeline resolves it once (see getWatchedGenreCounts) and
 * passes it in. That also removed the `.slice(0, 50)` that silently capped the
 * baseline below whatever recentWatchLimit was set to.
 */
export function scoreCandidates(
  candidates: Candidate[],
  genreFamiliarity: Map<string, number>,
  config: PipelineConfig
): Candidate[] {
  // Similarity is read against the pool it came from rather than as an absolute
  // cosine, so the configured similarity weight buys the influence it claims.
  // One pass over the pool first, since the scale is a property of the pool.
  const similarityScale = buildSimilarityScale(candidates.map((c) => c.similarity))

  for (const candidate of candidates) {
    // Use shared rating score calculation (handles bad data, proper scaling)
    const ratingScore = calculateRatingScore(candidate.communityRating)

    // Use shared novelty score calculation (handles missing genres)
    const novelty = calculateGenreNoveltyScore(candidate.genres, genreFamiliarity)

    // Raw similarity stays untouched for evidence, explanations and storage.
    const normalizedSimilarity = normalizeSimilarity(candidate.similarity, similarityScale)

    candidate.novelty = novelty
    candidate.ratingScore = ratingScore
    candidate.normalizedSimilarity = normalizedSimilarity

    // Calculate base score using shared function
    candidate.finalScore = calculateBaseScore(normalizedSimilarity, novelty, ratingScore, config)
  }

  // Sort by final score
  candidates.sort((a, b) => b.finalScore - a.finalScore)

  return candidates
}
