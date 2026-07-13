/**
 * usePosterPrefs Hook
 *
 * Hook for accessing poster display preferences (library rating badge).
 */

import { useContext } from 'react'
import { PosterPrefsContext } from './poster-prefs-context'

export function usePosterPrefs() {
  const context = useContext(PosterPrefsContext)
  if (!context) {
    throw new Error('usePosterPrefs must be used within a PosterPrefsProvider')
  }
  return context
}
