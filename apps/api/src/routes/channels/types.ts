export type ChannelOutputType = 'playlist' | 'collection'

export type ChannelMediaType = 'movie' | 'series'

export interface ChannelRow {
  id: string
  owner_id: string
  name: string
  description: string | null
  genre_filters: string[]
  text_preferences: string | null
  example_movie_ids: string[]
  example_series_ids: string[]
  media_types: ChannelMediaType[]
  include_seeds: boolean
  is_pinned_row: boolean
  playlist_id: string | null
  output_type: ChannelOutputType
  collection_id: string | null
  is_active: boolean
  last_generated_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface ChannelCreateBody {
  name: string
  description?: string
  genreFilters?: string[]
  textPreferences?: string
  exampleMovieIds?: string[]
  exampleSeriesIds?: string[]
  mediaTypes?: ChannelMediaType[]
  includeSeeds?: boolean
  isPinnedRow?: boolean
  outputType?: ChannelOutputType
}

export interface ChannelUpdateBody {
  name?: string
  description?: string
  genreFilters?: string[]
  textPreferences?: string
  exampleMovieIds?: string[]
  exampleSeriesIds?: string[]
  mediaTypes?: ChannelMediaType[]
  includeSeeds?: boolean
  isPinnedRow?: boolean
  isActive?: boolean
}

/**
 * Keep only the media types the channel schema accepts. An empty or unrecognised list falls back
 * to movie-only, which is the column default and the behaviour every pre-existing channel had.
 */
export function sanitizeMediaTypes(raw: unknown): ChannelMediaType[] {
  if (!Array.isArray(raw)) return ['movie']
  const types = raw.filter((t): t is ChannelMediaType => t === 'movie' || t === 'series')
  return types.length > 0 ? [...new Set(types)] : ['movie']
}
