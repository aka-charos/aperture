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
 * Where on the 0-1 novelty axis the response peaks. Half the item's genre mass
 * being unfamiliar is the "familiar anchor plus something new" case the score
 * is meant to reward.
 */
export const NOVELTY_SWEET_SPOT = 0.5

/**
 * The three points the response curve passes through. These are the values the
 * previous branch-based implementation produced at its representative input
 * (its continuous term was pinned near 0.85, so its branches evaluated to
 * ~0.84 / ~0.57 / ~0.47), which keeps this change about *what* novelty
 * measures rather than quietly enlarging how much it counts. Novelty is 25% of
 * the base score at default weights, so widening this band would have
 * re-weighted the whole recommender as a side effect.
 */
export const NOVELTY_PEAK = 0.84
export const NOVELTY_FAMILIAR_FLOOR = 0.57
export const NOVELTY_ALIEN_FLOOR = 0.47

/**
 * Index a user's watched-genre counts as familiarity in [0,1], normalized by
 * their own most-watched genre: their top genre is 1.0 and a genre they have
 * never watched is 0.
 *
 * Normalizing by the max rather than by total genre occurrences is the whole
 * point. Share-of-total is ~1/20 for every genre once a library has ~20 of
 * them, so the old `1 - count/totalOccurrences` pinned into [0.8, 1.0] and
 * contributed an 0.08 spread to a score that was otherwise decided by a
 * discrete branch. Max-normalizing uses the full range, so the continuous
 * measure carries the signal again.
 *
 * Keys are lowercased, matching buildGenreWeightMap in taste-profile/index.ts.
 */
export function buildGenreFamiliarity(genreCounts: Map<string, number>): Map<string, number> {
  const familiarity = new Map<string, number>()
  if (genreCounts.size === 0) return familiarity

  let maxCount = 0
  for (const count of genreCounts.values()) {
    if (Number.isFinite(count) && count > maxCount) maxCount = count
  }
  if (maxCount <= 0) return familiarity

  for (const [genre, count] of genreCounts) {
    if (!Number.isFinite(count) || count <= 0) continue
    familiarity.set(genre.toLowerCase(), Math.min(1, count / maxCount))
  }

  return familiarity
}

/**
 * How much new ground a candidate covers relative to what the user actually
 * watches, on a continuous curve that peaks at partial novelty.
 *
 * Rises from NOVELTY_FAMILIAR_FLOOR (every genre is one of their staples) to
 * NOVELTY_PEAK at NOVELTY_SWEET_SPOT, then falls to NOVELTY_ALIEN_FLOOR (no
 * genre they have ever watched). The fall is deliberately shallower than the
 * rise: a genre-alien item already scores low on `similarity`, and penalizing
 * it twice was never the intent -- whereas an item made entirely of staples is
 * exactly what similarity over-rewards, so novelty is the counterweight.
 *
 * Genres the user has never watched contribute 0 familiarity rather than being
 * counted as a separate binary "novel genre" flag. That flag was the previous
 * implementation's real decision variable, and it made a single unfamiliar
 * genre worth 0.27 of novelty -- more than twice the spread across an entire
 * selected list -- on a baseline of only 50 items.
 *
 * An item with no genres, or a user with no watch history, scores a neutral
 * 0.5, unchanged from before.
 */
export function calculateGenreNoveltyScore(
  itemGenres: string[],
  familiarity: Map<string, number>
): number {
  if (!itemGenres || itemGenres.length === 0) return 0.5
  if (familiarity.size === 0) return 0.5

  let familiaritySum = 0
  for (const genre of itemGenres) {
    familiaritySum += familiarity.get(genre.toLowerCase()) ?? 0
  }

  const novelty = 1 - familiaritySum / itemGenres.length

  if (novelty <= NOVELTY_SWEET_SPOT) {
    return (
      NOVELTY_FAMILIAR_FLOOR +
      (NOVELTY_PEAK - NOVELTY_FAMILIAR_FLOOR) * (novelty / NOVELTY_SWEET_SPOT)
    )
  }

  return (
    NOVELTY_ALIEN_FLOOR +
    (NOVELTY_PEAK - NOVELTY_ALIEN_FLOOR) * ((1 - novelty) / (1 - NOVELTY_SWEET_SPOT))
  )
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
  /**
   * How well this candidate matches the user: similarity/novelty/rating blended
   * by the configured weights, then nudged by franchise/genre/interest
   * preferences. This is what the "% Match" badge shows, so it must stay
   * comparable across every candidate in a run -- selection deliberately does
   * not overwrite it (see selectionScore).
   */
  finalScore: number
  /**
   * finalScore blended with the diversity boost, i.e. the number the diversity
   * selector actually ranked by. Set only on candidates that were selected, and
   * only for diagnostics -- it is not comparable to finalScore and must never
   * be shown as a match percentage.
   */
  selectionScore?: number
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




// ============================================================================
// Score composition diagnostics
// ============================================================================

export interface ComponentSummary {
  min: number
  p10: number
  p50: number
  p90: number
  max: number
}

export interface ScoreComponentReport {
  count: number
  similarity: ComponentSummary
  novelty: ComponentSummary
  rating: ComponentSummary
  finalScore: ComponentSummary
  /**
   * How much each term actually moves the ranking: its share of the configured
   * weight times its realized p10-p90 spread. A weight only controls influence
   * if the terms it is weighing have comparable spread, and nothing checked
   * that -- which is how a novelty term whose whole range was three values came
   * to outweigh similarity despite carrying half its weight.
   */
  influence: {
    similarity: number
    novelty: number
    rating: number
  }
}

/** Nearest-rank percentile over an already-sorted ascending array. */
function percentileOfSorted(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.round(fraction * (sorted.length - 1))
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))]
}

function summarizeValues(values: number[]): ComponentSummary {
  if (values.length === 0) return { min: 0, p10: 0, p50: 0, p90: 0, max: 0 }

  const sorted = [...values].sort((a, b) => a - b)
  return {
    min: sorted[0],
    p10: percentileOfSorted(sorted, 0.1),
    p50: percentileOfSorted(sorted, 0.5),
    p90: percentileOfSorted(sorted, 0.9),
    max: sorted[sorted.length - 1],
  }
}

/**
 * Distribution of every scoring term across a candidate pool, plus what each
 * one contributes to the ordering.
 *
 * Pure, and reported rather than acted on. Two bugs found by measuring instead
 * of reasoning -- a taste-dispersion score that was identical for every user,
 * and a novelty term that was three discrete values -- shared the same shape: a
 * quantity assumed to vary that did not. This is the check that would have
 * caught either on the first run.
 *
 * `similarity` is floored at 0 to match calculateBaseScore, so the reported
 * spread is the one that actually feeds the score.
 */
export function summarizeScoreComponents(
  candidates: Array<Pick<BaseCandidate, 'similarity' | 'novelty' | 'ratingScore' | 'finalScore'>>,
  config: Pick<ScoringConfig, 'similarityWeight' | 'noveltyWeight' | 'ratingWeight'>
): ScoreComponentReport {
  const similarity = summarizeValues(candidates.map((c) => Math.max(0, c.similarity)))
  const novelty = summarizeValues(candidates.map((c) => c.novelty))
  const rating = summarizeValues(candidates.map((c) => c.ratingScore))
  const finalScore = summarizeValues(candidates.map((c) => c.finalScore))

  const totalWeight = config.similarityWeight + config.noveltyWeight + config.ratingWeight
  // Mirrors calculateBaseScore's own fallback when every slider is at zero.
  const share = (weight: number) => (totalWeight > 0 ? weight / totalWeight : 1 / 3)

  return {
    count: candidates.length,
    similarity,
    novelty,
    rating,
    finalScore,
    influence: {
      similarity: share(config.similarityWeight) * (similarity.p90 - similarity.p10),
      novelty: share(config.noveltyWeight) * (novelty.p90 - novelty.p10),
      rating: share(config.ratingWeight) * (rating.p90 - rating.p10),
    },
  }
}
