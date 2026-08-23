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
 * The three points the response curve passes through, spanning the full [0,1].
 *
 * They used to be 0.84 / 0.57 / 0.47 -- the values the old branch-based
 * implementation produced at its representative input -- held deliberately so
 * that replacing the branches with a curve stayed a change about *what*
 * novelty measures rather than how much it counts. That was the right call
 * then and it left a structural handicap behind: a 0.37-wide output competing
 * in a weighted average against two terms that use the whole range.
 *
 * Influence is weight share x realized spread, so the handicap came straight
 * off the slider. Measured across nine users on a live instance, novelty's
 * p10-p90 spread ran 0.133-0.289 against similarity's 0.577 and rating's
 * steady 0.46; a novelty weight configured at 8.1% delivered between 2.1% and
 * 4.5% of the actual movement, depending on the viewer. Turning the knob up
 * and feeling nothing is the experience that produces a knob left at 1%.
 *
 * The stretch preserves the curve's PROPORTIONS exactly: the familiar floor
 * still sits (0.57-0.47)/(0.84-0.47) = 0.27 of the way from the alien floor to
 * the peak, so the shape of the response is untouched and only its scale
 * changes. It also retires a display problem -- a bar that could never read
 * below 47% or above 84% needed a "scale 47-84%" caption to be intelligible,
 * and now needs none.
 */
export const NOVELTY_PEAK = 1
export const NOVELTY_FAMILIAR_FLOOR = 0.27
export const NOVELTY_ALIEN_FLOOR = 0

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
 * genre they have ever watched). Both ends are penalized and the alien end
 * further -- it sits below the familiar floor, not above it. An older comment
 * here claimed the opposite ("the fall is deliberately shallower than the
 * rise"), which never matched the numbers in either implementation: the legacy
 * branches put `tooNovel` a flat 0.1 below `allFamiliar` at every input.
 * What is true is that an all-staples item is what similarity over-rewards, so
 * novelty is the counterweight there.
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
 * How hard the standardized similarity is squashed back into [0,1]. A candidate
 * one standard deviation above the pool mean lands at ~0.73, two at ~0.88, and
 * nothing ever reaches 0 or 1 -- which is the point: no candidate gets clipped
 * into a tie with its neighbours, so the ordering keeps full resolution at the
 * top of the pool, where selection actually happens.
 */
const SIMILARITY_Z_SOFTNESS = 2

/**
 * The pool's own similarity distribution, which is what a raw cosine has to be
 * read against to mean anything.
 */
export interface SimilarityScale {
  mean: number
  stdDev: number
}

/**
 * Summarize a candidate pool's similarity spread.
 *
 * Computed per run over every candidate, because it is a property of the pool
 * and the embedding model, not of any candidate.
 */
export function buildSimilarityScale(similarities: number[]): SimilarityScale {
  if (similarities.length === 0) return { mean: 0, stdDev: 0 }

  let sum = 0
  let count = 0
  for (const value of similarities) {
    if (!Number.isFinite(value)) continue
    sum += value
    count++
  }
  if (count === 0) return { mean: 0, stdDev: 0 }

  const mean = sum / count

  let squaredError = 0
  for (const value of similarities) {
    if (!Number.isFinite(value)) continue
    squaredError += (value - mean) ** 2
  }

  return { mean, stdDev: Math.sqrt(squaredError / count) }
}

/**
 * Map a raw cosine similarity onto [0,1] relative to the pool it was drawn
 * from, so that the configured similarity weight actually buys influence.
 *
 * The weighted average in calculateBaseScore assumes its three inputs are
 * comparable 0-1 quantities. Rating and novelty are: both are deliberate
 * mappings that use a real fraction of the range (measured p10-p90 spreads of
 * ~0.46 and ~0.26). Raw cosine is not. Embeddings of one library occupy a
 * narrow cone, and ANN retrieval then returns that cone's *nearest* slice, so
 * on a live instance the whole 16k-candidate pool spanned about 0.04 between
 * p10 and p90.
 *
 * Influence is `weight share x realized spread`, so a 0.72 similarity weight
 * bought 0.039 of influence while a 0.25 rating weight bought 0.117. The
 * recommender was effectively sorting by community rating -- which is static,
 * and is why the same titles kept coming back no matter what else changed.
 *
 * Standardizing against the pool's mean and standard deviation, then squashing
 * through tanh, restores a comparable spread (~0.57 between p10 and p90) while
 * preserving the ordering exactly, since the transform is strictly monotone. A
 * degenerate pool -- every candidate at the same distance, or a single
 * candidate -- yields no spread to speak of, so everything scores a neutral 0.5
 * and the other terms decide, which is the honest answer rather than
 * manufacturing separation out of noise.
 *
 * The trade this makes deliberately: the result is *relative to the run's
 * pool*, so it says "how close is this compared with the alternatives" rather
 * than "how close is this in absolute cosine". Absolute cosine is kept
 * untouched on the candidate for evidence, explanations, and storage; only the
 * blend reads this.
 */
export function normalizeSimilarity(similarity: number, scale: SimilarityScale): number {
  if (!Number.isFinite(similarity)) return 0.5
  if (!Number.isFinite(scale.stdDev) || scale.stdDev <= 0) return 0.5

  const z = (similarity - scale.mean) / scale.stdDev
  return 0.5 + 0.5 * Math.tanh(z / SIMILARITY_Z_SOFTNESS)
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
 * Exactly the weights calculateBaseScore consumes -- diversity is deliberately
 * not among them, because it is blended into the selection ordering rather than
 * into the match.
 *
 * Named as its own type because it is now also *stored*, per run, so the
 * insights panel can state the arithmetic it used. The weights are resolved by
 * loadConfigForUser and are therefore per user, which is why the admin's
 * current global config is not a substitute: two people's runs on the same day
 * can blend differently.
 */
export type BlendWeights = Pick<
  ScoringConfig,
  'similarityWeight' | 'noveltyWeight' | 'ratingWeight'
>

/**
 * Base candidate interface that both movies and series extend
 */
export interface BaseCandidate {
  id: string
  title: string
  year: number | null
  genres: string[]
  /**
   * Raw cosine similarity to the taste vector, as retrieved. Kept absolute for
   * evidence, explanations and storage -- the score blend reads
   * normalizedSimilarity instead (see normalizeSimilarity for why).
   */
  similarity: number
  /**
   * `similarity` rescaled against the run's own candidate pool. This is the
   * value calculateBaseScore consumes, and the one whose spread determines how
   * much the configured similarity weight is really worth.
   */
  normalizedSimilarity: number
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
   * finalScore as calculateBaseScore returned it, before
   * applyPreferenceAdjustment moved it. Stored so the insights panel can show
   * the preference nudge as its own step: the three score components blend to
   * this, and `finalScore - baseScore` is what franchise/genre/interest
   * affinities added or removed. Without it the components cannot reconstruct
   * the match, which is exactly how a panel titled "How We Calculated Your
   * Match" came to show three numbers that do not produce it.
   */
  baseScore?: number
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
  config: BlendWeights
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
 * The spread a component needs before its configured weight buys the influence
 * that weight claims.
 *
 * Not a tuning knob, and not an average of the three: normalizeSimilarity
 * produces this by construction. tanh(z/2) over a roughly normal z lands its
 * p10-p90 near 0.57 whatever the pool looks like, and measured across nine
 * users on a live instance it read 0.546-0.577 -- the steadiest quantity in
 * the whole pipeline. Similarity is therefore the term already on scale, and
 * the other two are corrected onto it rather than all three onto some average.
 */
export const TARGET_COMPONENT_SPREAD = 0.57

/**
 * Rating's realized spread, measured rather than derived.
 *
 * calculateRatingScore maps 0-10 onto 0-1, but no real library holds films
 * rated 2.0, so the bottom of that range is never used. What comes out is
 * remarkably steady: 0.46 for eight of nine users on the live instance and
 * 0.44 for the ninth. A constant is the right instrument for a constant
 * shortfall -- there is nothing per-run to adapt to.
 */
const RATING_TYPICAL_SPREAD = 0.46

/**
 * How far a novelty gain may travel from 1.0.
 *
 * Novelty is the one term whose spread genuinely varies by viewer -- 2.2x
 * across the same nine users, 0.133 to 0.289 before the band was widened -- so
 * it gets a per-run gain where rating gets a constant. The bounds keep that
 * honest in the direction that matters: a pool where every candidate shares a
 * genre profile has almost no novelty signal, and dividing by its tiny spread
 * would hand the ranking to noise. Measured against real pools the gains land
 * in [0.73, 1.58], so the clamp binds on exactly one user and only just -- it
 * is a guard rail, not a mechanism.
 */
const MIN_NOVELTY_GAIN = 0.7
const MAX_NOVELTY_GAIN = 1.5

/** p90 - p10, the same measure summarizeScoreComponents reports as influence. */
export function spreadOf(values: number[]): number {
  const summary = summarizeValues(values.filter((v) => Number.isFinite(v)))
  return summary.p90 - summary.p10
}

/**
 * Correct the configured weights by how much of the range each term actually
 * uses, so that influence tracks the slider rather than the term's shape.
 *
 * Influence is weight share x realized spread. Nothing enforced the second
 * factor, so the sliders were never the whole story: at a configured 70.4 /
 * 8.1 / 21.4 one live run delivered 77.8 / 3.3 / 18.9, and the novelty figure
 * varied by a factor of two between users on identical settings.
 *
 * The correction goes on the WEIGHT and not on the component, deliberately.
 * Both produce identical rankings -- w/spread x value orders the same as w x
 * value/spread -- but only this direction leaves the numbers on screen alone.
 * "Quality 82%" means IMDb 8.2, exactly and checkably, and rescaling the
 * component to fix an influence problem would destroy that to no purpose.
 *
 * Deliberately NOT a blanket standardization of all three. Similarity's
 * compression is an artifact of the embedding cone and of ANN returning its
 * nearest slice, which is why normalizeSimilarity corrects it per pool.
 * Novelty's and rating's are often real: a pool where every candidate is a
 * crime-thriller has no genre variation to report, and manufacturing some
 * would be the same error as reading twin affinity off centroids that span
 * 0.898-0.993.
 */
export function effectiveBlendWeights(weights: BlendWeights, noveltySpread: number): BlendWeights {
  return {
    // Already on scale: normalizeSimilarity is the correction.
    similarityWeight: weights.similarityWeight,
    noveltyWeight: weights.noveltyWeight * noveltyGain(noveltySpread),
    ratingWeight: weights.ratingWeight * (TARGET_COMPONENT_SPREAD / RATING_TYPICAL_SPREAD),
  }
}

/**
 * A pool with no novelty spread at all gets no gain rather than an infinite
 * one. Harmless either way -- a constant term cannot change an ordering -- but
 * 1.0 is the honest answer to "we could not measure this".
 */
export function noveltyGain(spread: number): number {
  if (!Number.isFinite(spread) || spread <= 0) return 1
  const gain = TARGET_COMPONENT_SPREAD / spread
  return Math.max(MIN_NOVELTY_GAIN, Math.min(MAX_NOVELTY_GAIN, gain))
}

/**
 * The share of the blend each term actually carries, i.e. the multipliers
 * calculateBaseScore applies once it has divided by the total weight.
 *
 * The sliders are independent 0-1 values with no sum-to-1 constraint, so the
 * configured 0.4 / 0.2 / 0.2 is really 0.50 / 0.25 / 0.25 -- and it is the
 * second set the reader needs, because those are the numbers that multiply the
 * three bars on the insights panel to produce the match. Showing the raw
 * slider values there would be a third scale on a page that already had three.
 *
 * Lives beside calculateBaseScore rather than in the API layer so the display
 * cannot drift from the arithmetic: the zero-total fallback below is the same
 * equal-thirds branch the blend takes, and if one changes the other has to.
 *
 * Returns null when any weight is missing, which is how a run predating
 * migration 0147 reaches the panel. Null means "cannot be stated", never zero.
 */
export function blendWeightShares(
  weights: Partial<BlendWeights> | null | undefined
): { similarity: number; novelty: number; rating: number } | null {
  if (!weights) return null

  const { similarityWeight, noveltyWeight, ratingWeight } = weights
  if (
    !Number.isFinite(similarityWeight) ||
    !Number.isFinite(noveltyWeight) ||
    !Number.isFinite(ratingWeight)
  ) {
    return null
  }

  const total = similarityWeight! + noveltyWeight! + ratingWeight!
  // Mirrors calculateBaseScore: with no weight at all it averages the three.
  if (total <= 0) return { similarity: 1 / 3, novelty: 1 / 3, rating: 1 / 3 }

  return {
    similarity: similarityWeight! / total,
    novelty: noveltyWeight! / total,
    rating: ratingWeight! / total,
  }
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
  /**
   * The cosine as retrieved. Reported alongside the normalized value so a run's
   * log shows how compressed the raw embedding cone was -- the gap between
   * these two spreads is the whole reason normalizeSimilarity exists.
   */
  rawSimilarity: ComponentSummary
  /** What the blend actually consumed. */
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
 * `similarity` is the normalized value floored at 0 to match calculateBaseScore,
 * so the reported spread is the one that actually feeds the score.
 */
export function summarizeScoreComponents(
  candidates: Array<
    Pick<
      BaseCandidate,
      'similarity' | 'normalizedSimilarity' | 'novelty' | 'ratingScore' | 'finalScore'
    >
  >,
  config: Pick<ScoringConfig, 'similarityWeight' | 'noveltyWeight' | 'ratingWeight'>
): ScoreComponentReport {
  const rawSimilarity = summarizeValues(candidates.map((c) => c.similarity))
  const similarity = summarizeValues(candidates.map((c) => Math.max(0, c.normalizedSimilarity)))
  const novelty = summarizeValues(candidates.map((c) => c.novelty))
  const rating = summarizeValues(candidates.map((c) => c.ratingScore))
  const finalScore = summarizeValues(candidates.map((c) => c.finalScore))

  const totalWeight = config.similarityWeight + config.noveltyWeight + config.ratingWeight
  // Mirrors calculateBaseScore's own fallback when every slider is at zero.
  const share = (weight: number) => (totalWeight > 0 ? weight / totalWeight : 1 / 3)

  return {
    count: candidates.length,
    rawSimilarity,
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
