/**
 * Shared Scoring Functions for Recommendation Algorithm
 *
 * These functions provide consistent scoring behavior for both
 * movies and series recommendations.
 */

/**
 * Calculate rating score using absolute 0-10 scale with tiered scoring.
 * Handles bad data (ratings > 10) and missing ratings gracefully.
 *
 * Score ranges:
 * - 8.0-10.0: 0.8-1.0 (excellent)
 * - 7.0-8.0:  0.6-0.8 (good)
 * - 6.0-7.0:  0.4-0.6 (average)
 * - 5.0-6.0:  0.2-0.4 (below average)
 * - 0.0-5.0:  0.0-0.2 (poor)
 * - null:     0.4 (neutral default)
 */
export function calculateRatingScore(rating: number | null | undefined): number {
  if (rating == null) {
    return 0.4 // Neutral default - doesn't advantage or disadvantage
  }

  // Clamp rating to 0-10 range (handles bad data like 101.00)
  const clampedRating = Math.min(Math.max(rating, 0), 10)

  if (clampedRating >= 8) {
    return 0.8 + (clampedRating - 8) * 0.1 // 8.0 -> 0.8, 10.0 -> 1.0
  } else if (clampedRating >= 7) {
    return 0.6 + (clampedRating - 7) * 0.2 // 7.0 -> 0.6, 8.0 -> 0.8
  } else if (clampedRating >= 6) {
    return 0.4 + (clampedRating - 6) * 0.2 // 6.0 -> 0.4, 7.0 -> 0.6
  } else if (clampedRating >= 5) {
    return 0.2 + (clampedRating - 5) * 0.2 // 5.0 -> 0.2, 6.0 -> 0.4
  } else {
    return clampedRating / 25 // 0.0 -> 0.0, 5.0 -> 0.2
  }
}

/**
 * Calculate novelty score based on genre overlap with watched content.
 *
 * The novelty score rewards items that introduce some new genres while
 * still having some familiar genres (partial novelty is best).
 *
 * @param itemGenres - Genres of the candidate item
 * @param watchedGenreCounts - Map of genre -> count from user's watch history
 * @param totalWatchedGenres - Total genre occurrences in watch history
 */
export function calculateNoveltyScore(
  itemGenres: string[],
  watchedGenreCounts: Map<string, number>,
  totalWatchedGenres: number
): number {
  // Default for items without genre data - neutral score
  if (!itemGenres || itemGenres.length === 0) {
    return 0.5
  }

  // Calculate how novel each genre is (1 = completely new, 0 = very common)
  const genreNovelties = itemGenres.map((genre) => {
    const count = watchedGenreCounts.get(genre) || 0
    if (totalWatchedGenres === 0) return 0.5 // No watch history = neutral
    return 1 - count / totalWatchedGenres
  })

  // Average novelty across all genres
  const avgNovelty = genreNovelties.reduce((a, b) => a + b, 0) / genreNovelties.length

  // Count completely novel genres (not in watch history at all)
  const novelGenreCount = itemGenres.filter((g) => !watchedGenreCounts.has(g)).length
  const noveltyRatio = novelGenreCount / itemGenres.length

  // Reward partial novelty (some new genres, some familiar)
  // Pure novelty (all new) is risky, no novelty is boring
  if (noveltyRatio > 0 && noveltyRatio < 0.7) {
    // Sweet spot: 1-70% new genres
    return 0.5 + avgNovelty * 0.4 // 0.5-0.9 range
  } else if (noveltyRatio >= 0.7) {
    // Too novel - user hasn't shown interest in these genres
    return 0.3 + avgNovelty * 0.2 // 0.3-0.5 range
  } else {
    // No novelty - all familiar genres
    return 0.4 + avgNovelty * 0.2 // 0.4-0.6 range
  }
}

/**
 * Configuration for scoring weights
 */
export interface ScoringConfig {
  similarityWeight: number
  noveltyWeight: number
  ratingWeight: number
  diversityWeight: number
}

/**
 * Base candidate interface that both movies and series extend
 */
export interface BaseCandidate {
  id: string
  title: string
  year: number | null
  genres: string[]
  similarity: number
  novelty: number
  ratingScore: number
  diversityBoost: number
  finalScore: number
}

/**
 * Calculate the base score for a candidate (before diversity).
 * This combines similarity, novelty, and rating using the configured weights.
 *
 * similarityWeight/noveltyWeight/ratingWeight are independent 0-1 sliders
 * (see AlgorithmSettingsSection) with no enforced sum-to-1 constraint, so we
 * normalize by their total here. That makes this a true weighted AVERAGE of
 * three 0-1 inputs — always bounded to [0,1] — rather than a weighted SUM,
 * which could exceed 1 whenever an admin/user pushes multiple sliders high.
 */
export function calculateBaseScore(
  similarity: number,
  novelty: number,
  ratingScore: number,
  config: Pick<ScoringConfig, 'similarityWeight' | 'noveltyWeight' | 'ratingWeight'>
): number {
  // Cosine similarity can dip slightly negative for taste-opposite content;
  // a "match" is never negative, so floor it before blending.
  const clampedSimilarity = Math.max(0, similarity)

  const totalWeight = config.similarityWeight + config.noveltyWeight + config.ratingWeight
  if (totalWeight <= 0) {
    return (clampedSimilarity + novelty + ratingScore) / 3
  }

  return (
    (config.similarityWeight * clampedSimilarity +
      config.noveltyWeight * novelty +
      config.ratingWeight * ratingScore) /
    totalWeight
  )
}

/**
 * Relative strength of each preference dimension in `applyPreferenceAdjustment`.
 * Mirrors the old boost design intent: franchise/genre preferences could each
 * swing further than a custom interest match, which was always meant as a
 * lighter-touch signal.
 */
const PREFERENCE_DIMENSION_WEIGHTS = {
  franchise: 0.5,
  genre: 0.5,
  interest: 0.3,
} as const

const PREFERENCE_TOTAL_WEIGHT =
  PREFERENCE_DIMENSION_WEIGHTS.franchise +
  PREFERENCE_DIMENSION_WEIGHTS.genre +
  PREFERENCE_DIMENSION_WEIGHTS.interest

/**
 * Fraction of the remaining headroom to 1.0 (or down to 0.0, if disliked)
 * that a maxed-out combined preference signal is allowed to close. Content
 * fit still casts the deciding vote — loving a franchise can narrow the gap
 * toward a "perfect" match, but can't manufacture one out of a poor
 * content-fit score on its own.
 */
const MAX_PREFERENCE_HEADROOM = 0.5

/**
 * Franchise/genre/custom-interest affinities for a candidate, each on a
 * 0 (avoid) - 0.5 (neutral / no signal) - 1 (loved) scale. 0.5 is a true
 * no-op in `applyPreferenceAdjustment`, whether it means "explicitly
 * neutral" or "no preference recorded" — both should leave the score
 * unchanged.
 */
export interface PreferenceAffinities {
  franchise: number
  genre: number
  interest: number
}

/**
 * Nudge a bounded [0,1] quality score toward 1 (liked) or 0 (disliked) based
 * on explicit franchise/genre/custom-interest preferences.
 *
 * Each active signal (affinity != 0.5) pulls the score a fraction of the way
 * toward its target edge, scaled by `MAX_PREFERENCE_HEADROOM` and the
 * signal's relative weight. Because the pull is always a fraction of
 * *remaining* headroom (`1 - qualityScore` when pulling up, `qualityScore`
 * when pulling down), the result is bounded to [0,1] by construction for any
 * combination of affinities — no clamping needed, and three strong
 * preferences stacking together can no longer push a score past 100% the
 * way the old multiplicative boosts could.
 */
export function applyPreferenceAdjustment(
  qualityScore: number,
  affinities: PreferenceAffinities
): number {
  let netPull = 0 // -1 (fully disliked) .. +1 (fully loved)

  for (const dimension of Object.keys(PREFERENCE_DIMENSION_WEIGHTS) as Array<
    keyof typeof PREFERENCE_DIMENSION_WEIGHTS
  >) {
    const signedAffinity = (affinities[dimension] - 0.5) * 2 // -1..1
    netPull += (signedAffinity * PREFERENCE_DIMENSION_WEIGHTS[dimension]) / PREFERENCE_TOTAL_WEIGHT
  }

  if (netPull === 0) return qualityScore

  const headroom = netPull > 0 ? 1 - qualityScore : qualityScore
  return qualityScore + netPull * MAX_PREFERENCE_HEADROOM * headroom
}



