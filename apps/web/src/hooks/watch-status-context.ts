import { createContext } from 'react'

export interface WatchStatusContextValue {
  /** Keys are "movie-{id}" / "series-{id}", exactly as in UserRatingsProvider. */
  watched: Set<string>
  isWatched: (type: 'movie' | 'series', id: string) => boolean
  /**
   * Record a change this browser just made, so the grid behind the detail page
   * agrees with the button that was pressed on it. Local only — the server has
   * already been told by whoever calls this.
   */
  setWatched: (type: 'movie' | 'series', id: string, watched: boolean) => void
  loading: boolean
}

export const WatchStatusContext = createContext<WatchStatusContextValue | null>(null)
