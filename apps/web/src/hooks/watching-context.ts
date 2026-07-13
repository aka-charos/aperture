import { createContext } from 'react'

export interface UpcomingEpisode {
  seasonNumber: number
  episodeNumber: number
  title: string
  airDate: string
  source: 'emby' | 'tmdb'
}

export interface WatchingSeries {
  id: string
  seriesId: string
  title: string
  year: number | null
  posterUrl: string | null
  backdropUrl: string | null
  genres: string[]
  overview: string | null
  communityRating: number | null
  network: string | null
  status: string | null
  totalSeasons: number | null
  totalEpisodes: number | null
  /** Null for series that appear only via watch history */
  addedAt: string | null
  /** In user_watching_series (synced to media-server favorites) */
  inWatchlist: boolean
  /** Has watch history for at least one episode */
  inHistory: boolean
  episodesWatched: number
  episodesOnServer: number
  /** Episodes aired so far per TMDB (null until TMDB season data is cached) */
  episodesAired: number | null
  /** Aired episodes not present on the media server */
  episodesMissing: number
  tmdbTotalEpisodes: number | null
  tmdbTotalSeasons: number | null
  /** Aired seasons (per TMDB) with zero episodes on the media server */
  missingSeasons: number[]
  lastPlayedAt: string | null
  upcomingEpisode: UpcomingEpisode | null
}

/** Response from POST /api/watching/refresh (favorites reconcile) */
export interface WatchingRefreshResult {
  success: boolean
  message: string
  skipped: boolean
  reason?: string
  pushedToServer: number
  removedFromDb: number
  pulledIntoDb: number
  pushErrors: number
}

export interface WatchingContextValue {
  /** Set of series IDs the user is watching */
  watchingIds: Set<string>
  /** Full series data with enrichment */
  series: WatchingSeries[]
  /** Whether initial data is loading */
  loading: boolean
  /** Error message if any */
  error: string | null
  /** Whether a refresh is in progress */
  refreshing: boolean
  /** Check if a series is in the watching list */
  isWatching: (seriesId: string) => boolean
  /** Add a series to the watching list */
  addToWatching: (seriesId: string) => Promise<void>
  /** Remove a series from the watching list */
  removeFromWatching: (seriesId: string) => Promise<void>
  /** Toggle watching status for a series */
  toggleWatching: (seriesId: string) => Promise<void>
  /** Force refresh from server (invalidates cache) */
  refresh: () => Promise<void>
  /** Reconcile Shows You Watch with media server series favorites */
  refreshLibrary: () => Promise<WatchingRefreshResult>
}

export const WatchingContext = createContext<WatchingContextValue | null>(null)
