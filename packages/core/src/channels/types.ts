/** What a channel can generate. Channels default to movie-only. */
export type ChannelMediaType = 'movie' | 'series'

export interface Channel {
  id: string
  ownerId: string
  name: string
  description: string | null
  genreFilters: string[]
  textPreferences: string | null
  exampleMovieIds: string[]
  exampleSeriesIds: string[]
  mediaTypes: ChannelMediaType[]
  isPinnedRow: boolean
  playlistId: string | null
  isActive: boolean
}

export interface ChannelRecommendation {
  mediaType: ChannelMediaType
  /** Aperture id of the movies/series row this recommendation points at. */
  itemId: string
  providerItemId: string
  title: string
  year: number | null
  score: number
}

export interface ChannelUpdateOptions {
  /**
   * When true, expand the generated list with in-library titles the Web Search role
   * considers similar to the channel's seeds (no-op if the role is unconfigured).
   */
  webExpand?: boolean
}
