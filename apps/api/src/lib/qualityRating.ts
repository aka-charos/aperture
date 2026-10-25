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
import { storedQualityRating, unifiedRatingShares, type UnifiedRatingSource } from '@aperture/core'

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
