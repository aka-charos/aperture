export interface Channel {
  id: string
  ownerId: string
  name: string
  description: string | null
  genreFilters: string[]
  textPreferences: string | null
  exampleMovieIds: string[]
  isPinnedRow: boolean
  playlistId: string | null
  isActive: boolean
}

export interface ChannelRecommendation {
  movieId: string
  providerItemId: string
  title: string
  year: number | null
  score: number
}

export interface ChannelUpdateOptions {
  /**
   * When true, expand the generated list with in-library movies the Web Search role
   * considers similar to the channel's seed movies (no-op if the role is unconfigured).
   */
  webExpand?: boolean
}



