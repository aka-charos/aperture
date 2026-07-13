/**
 * PosterPrefsProvider
 *
 * Poster display preferences (currently: hide the community-rating badge on
 * library posters). Persisted in user preferences; localStorage caches the
 * value so posters render correctly on first paint without a badge flash.
 *
 * Also feeds @aperture/ui's PosterDisplaySettingsContext so MoviePoster picks
 * the preference up without threading a prop through every call site.
 */

import { useState, useCallback, useEffect, type ReactNode } from 'react'
import { PosterDisplaySettingsContext } from '@aperture/ui'
import { PosterPrefsContext } from './poster-prefs-context'

const STORAGE_KEY = 'aperture-poster-prefs'

function getInitialHidePosterRating(): boolean {
  try {
    const cached = localStorage.getItem(STORAGE_KEY)
    if (cached) {
      return (JSON.parse(cached) as { hidePosterRating?: boolean }).hidePosterRating === true
    }
  } catch {
    // localStorage not available or invalid JSON
  }
  return false
}

function cacheHidePosterRating(hide: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidePosterRating: hide }))
  } catch {
    // localStorage not available
  }
}

export function PosterPrefsProvider({ children }: { children: ReactNode }) {
  const [hidePosterRating, setHidePosterRatingState] = useState<boolean>(getInitialHidePosterRating)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const response = await fetch('/api/auth/me/preferences', { credentials: 'include' })
        if (response.ok) {
          const data = await response.json()
          const hide = data.hidePosterRating === true
          setHidePosterRatingState(hide)
          cacheHidePosterRating(hide)
        }
      } catch (err) {
        console.error('Failed to fetch poster preferences:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchPreferences()
  }, [])

  const setHidePosterRating = useCallback((hide: boolean) => {
    setHidePosterRatingState(hide)
    cacheHidePosterRating(hide)

    fetch('/api/auth/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ hidePosterRating: hide }),
    }).catch((err) => {
      console.error('Failed to save poster preference:', err)
    })
  }, [])

  return (
    <PosterPrefsContext.Provider value={{ hidePosterRating, setHidePosterRating, loading }}>
      <PosterDisplaySettingsContext.Provider value={{ hideLibraryRatingBadge: hidePosterRating }}>
        {children}
      </PosterDisplaySettingsContext.Provider>
    </PosterPrefsContext.Provider>
  )
}
