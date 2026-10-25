/**
 * The unified quality rating of one title, for a detail page (F-167).
 *
 * The same number the recommender scores on: read through the same cached
 * whole-table map and the same fallback (`scoringRating`), so a title page and
 * its recommendation can never show two ratings for one title. The sources ride
 * along as decided values -- the page says what the number is made of without
 * holding a copy of the rule, which the RT guard would make wrong.
 *
 * Never throws: the map answers empty on a failed read, and the title then
 * shows the media server's rating, as scoring does.
 */
import {
  getQualityRatings,
  scoringRating,
  unifiedRatingSources,
  type UnifiedRatingSource,
} from '@aperture/core'

export interface QualityRatingFields {
  quality_rating: number | null
  quality_rating_sources: UnifiedRatingSource[]
}

/** The rating columns a detail row carries. NUMERIC arrives from pg as text. */
export interface RatingColumns {
  community_rating: number | string | null
  imdb_rating: number | string | null
  tmdb_rating: number | string | null
  rt_critic_score: number | string | null
  metacritic_score: number | string | null
}

function num(value: number | string | null): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function qualityRatingFor(
  mediaType: 'movie' | 'series',
  id: string,
  row: RatingColumns
): Promise<QualityRatingFields> {
  const ratings = await getQualityRatings(mediaType)
  const community = num(row.community_rating)
  if (!ratings.has(id)) {
    // Not in the map (added since it was read, or a failed read): scoring
    // uses the media server's rating, so the page does too.
    return { quality_rating: community, quality_rating_sources: community != null ? ['mediaServer'] : [] }
  }
  const value = scoringRating(ratings, id, community)
  return {
    quality_rating: value,
    quality_rating_sources:
      value == null
        ? []
        : unifiedRatingSources(
            {
              imdb: num(row.imdb_rating),
              community,
              tmdb: num(row.tmdb_rating),
              rt: num(row.rt_critic_score),
              metacritic: num(row.metacritic_score),
            },
            mediaType
          ),
  }
}
