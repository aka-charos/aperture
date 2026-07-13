import { createContext } from 'react'

export interface PosterPrefsContextValue {
  /** Hide the community-rating badge on library posters (artwork may already include one) */
  hidePosterRating: boolean
  setHidePosterRating: (hide: boolean) => void
  loading: boolean
}

export const PosterPrefsContext = createContext<PosterPrefsContextValue | null>(null)
