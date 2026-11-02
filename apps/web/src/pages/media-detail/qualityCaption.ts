/**
 * The words under the insights panel's Quality bar: which rating the score was
 * computed from, and a warning when that is no longer the title's rating. Pure,
 * pinned by qualityCaption.test.ts.
 *
 * The decision is the server's (apps/api lib/qualityRating.ts qualityBasis);
 * this only chooses the sentence for it and formats each rating to the one
 * decimal the page headline prints, so the two read as the same number.
 */
import type { RecommendationInsights } from './types'

export type QualityBasis = NonNullable<RecommendationInsights['qualityBasis']>

/** An i18n key under mediaDetail.insights and its values. */
export interface CaptionText {
  key: string
  values?: Record<string, string>
}

export interface QualityCaption {
  /** Part of the grey caption: the rating the score is from, when current. */
  from: CaptionText | null
  /** The warning line: the score is from a rating the title no longer has. */
  note: CaptionText | null
}

/** A rating as the page headline prints it. */
export function formatRating(value: number): string {
  return value.toFixed(1)
}

export function qualityCaption(basis: QualityBasis | undefined): QualityCaption {
  // An older API sends nothing; the panel says what it always said.
  if (!basis) return { from: null, note: null }

  if (basis.current) {
    return {
      from:
        basis.rating != null
          ? { key: 'qualityFrom', values: { rating: formatRating(basis.rating) } }
          : { key: 'qualityUnrated' },
      note: null,
    }
  }

  const scored = basis.scoredRating != null ? formatRating(basis.scoredRating) : null
  if (basis.rating == null) {
    // Rated when scored, unrated now. With no number to name either side
    // there is nothing true to say.
    return { from: null, note: scored ? { key: 'qualityScoredOnOnly', values: { scored } } : null }
  }
  const rating = formatRating(basis.rating)
  return {
    from: null,
    note: scored
      ? { key: 'qualityScoredOn', values: { scored, rating } }
      : { key: 'qualityScoredOnUnknown', values: { rating } },
  }
}
