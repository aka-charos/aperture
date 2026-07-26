export type MediaType = 'movie' | 'series'

export interface Channel {
  id: string
  name: string
  description: string | null
  genre_filters: string[]
  text_preferences: string | null
  example_movie_ids: string[]
  example_series_ids?: string[]
  media_types?: MediaType[]
  is_pinned_row: boolean
  is_active: boolean
  playlist_id: string | null
  output_type?: 'playlist' | 'collection'
  collection_id?: string | null
  last_generated_at: string | null
}

/** Shared shape for a seed/search result — movies and series carry the same display fields. */
export interface MediaSummary {
  id: string
  title: string
  year: number | null
  poster_url: string | null
  provider_item_id?: string
}

export type Movie = MediaSummary

export interface PlaylistItem {
  id: string
  playlistItemId: string
  title: string
  year: number | null
  posterUrl: string | null
  runtime: number | null
}

export interface FormData {
  name: string
  description: string
  genreFilters: string[]
  textPreferences: string
  exampleMovies: MediaSummary[]
  exampleSeries: MediaSummary[]
  mediaTypes: MediaType[]
}

export interface SnackbarState {
  open: boolean
  message: string
  severity: 'success' | 'error'
}

export interface GraphPlaylist {
  id: string
  name: string
  description: string | null
  mediaServerPlaylistId: string
  ownerId: string
  sourceItemId: string | null
  sourceItemType: string | null
  itemCount: number
  createdAt: string
  updatedAt: string
}

export interface GraphPlaylistItem {
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  type: 'movie' | 'series'
}


