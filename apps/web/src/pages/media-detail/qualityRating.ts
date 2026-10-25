/**
 * The headline rating on a title page: the unified quality rating the server
 * decided (F-167), and enough about it to say what it is made of. Pure, pinned
 * by qualityRating.test.ts.
 *
 * Reads only decided values -- the number, its source list and the blend
 * shares -- never the raw columns or the weights: the server's rule drops
 * scores the columns still carry (an RT matched to the wrong film), and the
 * weights live in core, so a page working either out again drifts.
 */
import type { QualityRatingSource } from './types'

export type AudienceSource = 'imdb' | 'mediaServer' | 'tmdb'
export type CriticSource = 'metacritic' | 'rt'

export interface HeadlineRating {
  value: number
  /**
   * combined = audience and critics; audience or critics = one half only;
   * unknown = a number whose sources this build cannot name, which gets no
   * label rather than a wrong one.
   */
  basis: 'combined' | 'audience' | 'critics' | 'unknown'
  audience: AudienceSource | null
  critics: CriticSource[]
  /** Whole percentages of the blend, as the server decided them; null from an older API. */
  shares: { audience: number; critics: number } | null
}

const AUDIENCE: readonly AudienceSource[] = ['imdb', 'mediaServer', 'tmdb']
const CRITICS: readonly CriticSource[] = ['metacritic', 'rt']

function finite(value: number | string | null | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function headlineRating(media: {
  quality_rating?: number | string | null
  quality_rating_sources?: QualityRatingSource[]
  quality_rating_shares?: { audience: number; critics: number }
  community_rating: number | string | null
}): HeadlineRating | null {
  // Absent is an API from before the unified rating, not "no rating": it
  // keeps the headline it always had, the media server's own.
  if (media.quality_rating === undefined) {
    const value = finite(media.community_rating)
    return value == null ? null : { value, basis: 'audience', audience: 'mediaServer', critics: [], shares: null }
  }
  const value = finite(media.quality_rating)
  if (value == null) return null
  const sources = media.quality_rating_sources ?? []
  const audience = AUDIENCE.find((s) => sources.includes(s)) ?? null
  const critics = CRITICS.filter((s) => sources.includes(s))
  const basis = audience
    ? critics.length > 0
      ? 'combined'
      : 'audience'
    : critics.length > 0
      ? 'critics'
      : 'unknown'
  return { value, basis, audience, critics, shares: media.quality_rating_shares ?? null }
}
