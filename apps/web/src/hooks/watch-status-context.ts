import { createContext } from 'react'

/** Episodes played out of episodes the library holds, specials excluded. */
export interface EpisodeProgress {
  watched: number
  total: number
}

export interface WatchStatusContextValue {
  /** Movie ids the viewer has played. */
  watchedMovies: Set<string>
  /** Keyed by series id, and present only for shows the viewer has started. */
  seriesProgress: Map<string, EpisodeProgress>
  /** Finished: a played movie, or a series with every library episode played. */
  isWatched: (type: 'movie' | 'series', id: string) => boolean
  /**
   * Counts for a series the viewer is partway through. Undefined for a finished
   * show's caller to ignore, for an untouched one, and for a movie — the three
   * cases all draw nothing, so a mixed grid can call this without branching.
   */
  getEpisodeProgress: (type: 'movie' | 'series', id: string) => EpisodeProgress | undefined
  /**
   * Record a change this browser just made, so the grid behind the detail page
   * agrees with the button that was pressed on it. Local only — the server has
   * already been told by whoever calls this.
   *
   * Movies only, deliberately: neither media-server provider defines
   * `markEpisodePlayed`, so nothing in the app can mark a series watched.
   */
  setMovieWatched: (id: string, watched: boolean) => void
  loading: boolean
}

export const WatchStatusContext = createContext<WatchStatusContextValue | null>(null)
