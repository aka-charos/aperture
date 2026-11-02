/**
 * The unified quality rating of one title, for a detail page (F-167).
 *
 * Reads the pair stored on the title (`quality_rating`,
 * `quality_rating_sources`, migration 0213) through core's
 * storedQualityRating -- the same reader the scorers use, so a title page and
 * its recommendation can never show two ratings for one title, and the number
 * and the sources it names come from one computation. The blend shares ride
 * along as decided values, so the page's explanation follows a retune of the
 * weights instead of holding its own copy.
 *
 * Pure: the detail route selects the columns; this shapes them.
 */
import {
  calculateRatingScore,
  ratingFromScore,
  storedQualityRating,
  unifiedRatingShares,
  type UnifiedRatingSource,
} from '@aperture/core'

export interface QualityRatingFields {
  quality_rating: number | null
  quality_rating_sources: UnifiedRatingSource[]
  /** Whole percentages of the audience / critics blend. */
  quality_rating_shares: { audience: number; critics: number }
}

/** The rating columns a detail row carries. NUMERIC arrives from pg as text. */
export interface StoredRatingColumns {
  quality_rating?: number | string | null
  quality_rating_sources?: string[] | null
  community_rating: number | string | null
}

export function qualityRatingFields(row: StoredRatingColumns): QualityRatingFields {
  const { rating, sources } = storedQualityRating(row.quality_rating, row.quality_rating_sources, row.community_rating)
  return { quality_rating: rating, quality_rating_sources: sources, quality_rating_shares: unifiedRatingShares() }
}

/**
 * What a pick's Quality score was computed from, for the insights panel.
 *
 * The panel draws the score a run stored beside a headline that is the
 * title's rating NOW. The two disagree whenever the rating moved after the
 * run -- most visibly for runs made before the unified rating existed, which
 * scored the media server's number: a 6.8 scored 56% under a headline reading
 * 6.9 -- and nothing on the page said why. This decides it.
 *
 * Which rating the run read comes from `recommendation_candidates.scored_rating`
 * (0216) when the run stored it. Older rows have only the score, and for them
 * the score is read back through the curve (core ratingFromScore) -- exact for
 * every run scored on today's curve, and the only way to say anything about a
 * run made before the rating was stored.
 *
 * Two ratings that print the same to one decimal, as the headline does, are
 * the same rating to the reader: a run that scored 6.9437 under a headline
 * of 6.94 is current, not "scored on 6.9; the rating is now 6.9".
 */
export interface QualityBasis {
  /** True when the score was computed from the rating the headline shows. */
  current: boolean
  /** The title's rating now, as its page headline shows it; null when unrated. */
  rating: number | null
  /**
   * The rating the score was computed from, when it differs from `rating`.
   * Null when current, and when it cannot be known: an older row holding the
   * neutral default a title with no rating gets (0.4 is also a 6.0, so naming
   * a number there could be false), or a newer row whose title had no rating.
   */
  scoredRating: number | null
}

/**
 * Half a unit of the 4th decimal the score is stored at (NUMERIC(6, 4)), plus
 * slack for float arithmetic: anything closer is the same score.
 */
const SCORE_TOLERANCE = 0.0006

/** Whether two ratings print the same to one decimal, as the headline prints them. */
export function printsSameRating(a: number, b: number): boolean {
  return a.toFixed(1) === b.toFixed(1)
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function qualityBasis(
  ratingScore: number | string | null | undefined,
  storedScoredRating: number | string | null | undefined,
  row: StoredRatingColumns
): QualityBasis | null {
  const score = toNumber(ratingScore)
  if (score == null) return null
  const { rating } = storedQualityRating(row.quality_rating, row.quality_rating_sources, row.community_rating)

  // The run recorded the rating it read (0216): compare that directly.
  const recorded = toNumber(storedScoredRating)
  if (recorded != null) {
    const current = rating != null && printsSameRating(recorded, rating)
    return { current, rating, scoredRating: current ? null : recorded }
  }

  // Older rows, and titles that had no rating when scored: only the score.
  if (Math.abs(calculateRatingScore(rating) - score) <= SCORE_TOLERANCE) {
    return { current: true, rating, scoredRating: null }
  }
  if (Math.abs(calculateRatingScore(null) - score) <= SCORE_TOLERANCE) {
    return { current: false, rating, scoredRating: null }
  }
  const readBack = Math.round(ratingFromScore(score) * 100) / 100
  const current = rating != null && printsSameRating(readBack, rating)
  return { current, rating, scoredRating: current ? null : readBack }
}

/** The insights response field: absent, never null, when there is nothing to say. */
export function qualityBasisField(
  candidate: {
    rating_score: number | string | null | undefined
    scored_rating?: number | string | null | undefined
  },
  row: StoredRatingColumns | null | undefined
): { qualityBasis?: QualityBasis } {
  const basis = row ? qualityBasis(candidate.rating_score, candidate.scored_rating, row) : null
  return basis ? { qualityBasis: basis } : {}
}

/**
 * Points on the Quality curve the panel's tooltip quotes ("7 scores 60%"), so
 * the reader can see how a rating becomes the score without the bundle
 * holding a copy of the curve. Ratings chosen from the band most titles sit in.
 */
export const RATING_SCALE_EXAMPLES: ReadonlyArray<{ rating: number; score: number }> = [6, 7, 8].map((rating) => ({
  rating,
  score: calculateRatingScore(rating),
}))
