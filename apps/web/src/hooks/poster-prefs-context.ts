import { createContext } from 'react'

export interface PosterPrefsContextValue {
  /** Effective hide state for library poster rating badges = user override ?? server default */
  hidePosterRating: boolean
  /** User override: true/false is explicit; null means "inherit the server default" */
  userOverride: boolean | null
  /** Instance-wide default set by an admin */
  serverDefaultHide: boolean
  /** Set the user override. Pass true/false for an explicit choice, or null to reset to the server default. */
  setHidePosterRating: (value: boolean | null) => void
  loading: boolean
}

export const PosterPrefsContext = createContext<PosterPrefsContextValue | null>(null)
