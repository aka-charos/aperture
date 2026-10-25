/**
 * The headline rating on a title page: the unified quality rating the server
 * decided (F-167), and enough about it to say what it is made of. Pure, pinned
 * by qualityRating.test.ts.
 *
 * Reads only decided values -- the number and its source list -- never the raw
 * columns, because the server's rule drops scores the columns still carry (an
 * RT matched to the wrong film) and a page working it out again would name a
 * source the number does not contain.
 */
import type { QualityRatingSource } from './types'

export type AudienceSource = 'imdb' | 'mediaServer' | 'tmdb'
export type CriticSource = 'metacritic' | 'rt'

export interface HeadlineRating {
  value: number
  /** combined = audience and critics; audience or critics = one half only. */
  basis: 'combined' | 'audience' | 'critics'
  audience: AudienceSource | null
  critics: CriticSource[]
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
  community_rating: number | string | null
}): HeadlineRating | null {
  // Absent is an API from before the unified rating, not "no rating": it
  // keeps the headline it always had, the media server's own.
  if (media.quality_rating === undefined) {
    const value = finite(media.community_rating)
    return value == null ? null : { value, basis: 'audience', audience: 'mediaServer', critics: [] }
  }
  const value = finite(media.quality_rating)
  if (value == null) return null
  const sources = media.quality_rating_sources ?? []
  const audience = AUDIENCE.find((s) => sources.includes(s)) ?? null
  const critics = CRITICS.filter((s) => sources.includes(s))
  const basis = audience && critics.length > 0 ? 'combined' : critics.length > 0 ? 'critics' : 'audience'
  return { value, basis, audience, critics }
}
