/**
 * PosterPrefsProvider
 *
 * Poster display preferences (currently: hide the community-rating badge on
 * library posters). The effective value is the user's explicit override if set,
 * otherwise the instance-wide default an admin configured. Persisted in user
 * preferences; localStorage caches the resolved values so posters render
 * correctly on first paint without a badge flash.
 *
 * Also feeds @aperture/ui's PosterDisplaySettingsContext so MoviePoster picks
 * the preference up without threading a prop through every call site.
 */

import { useState, useCallback, useEffect, type ReactNode } from 'react'
import { PosterDisplaySettingsContext } from '@aperture/ui'
import { PosterPrefsContext } from './poster-prefs-context'

const STORAGE_KEY = 'aperture-poster-prefs'

interface CachedPrefs {
  /** User override: true/false explicit, null = inherit the server default */
  userOverride: boolean | null
  /** Instance-wide admin default */
  serverDefaultHide: boolean
}

function readCache(): CachedPrefs {
  try {
    const cached = localStorage.getItem(STORAGE_KEY)
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<CachedPrefs>
      return {
        userOverride:
          parsed.userOverride === true || parsed.userOverride === false
            ? parsed.userOverride
            : null,
        serverDefaultHide: parsed.serverDefaultHide === true,
      }
    }
  } catch {
    // localStorage not available or invalid JSON
  }
  return { userOverride: null, serverDefaultHide: false }
}

function writeCache(prefs: CachedPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage not available
  }
}

/** Effective hide = explicit user override, else server default. */
function resolveEffective(prefs: CachedPrefs): boolean {
  return prefs.userOverride ?? prefs.serverDefaultHide
}

export function PosterPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<CachedPrefs>(readCache)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const response = await fetch('/api/auth/me/preferences', { credentials: 'include' })
        if (response.ok) {
          const data = (await response.json()) as {
            hidePosterRating?: boolean | null
            posterRatingHiddenByDefault?: boolean
          }
          const next: CachedPrefs = {
            userOverride:
              data.hidePosterRating === true || data.hidePosterRating === false
                ? data.hidePosterRating
                : null,
            serverDefaultHide: data.posterRatingHiddenByDefault === true,
          }
          setPrefs(next)
          writeCache(next)
        }
      } catch (err) {
        console.error('Failed to fetch poster preferences:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchPreferences()
  }, [])

  const setHidePosterRating = useCallback((value: boolean | null) => {
    setPrefs((prev) => {
      const next = { ...prev, userOverride: value }
      writeCache(next)
      return next
    })

    fetch('/api/auth/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ hidePosterRating: value }),
    }).catch((err) => {
      console.error('Failed to save poster preference:', err)
    })
  }, [])

  const effectiveHide = resolveEffective(prefs)

  return (
    <PosterPrefsContext.Provider
      value={{
        hidePosterRating: effectiveHide,
        userOverride: prefs.userOverride,
        serverDefaultHide: prefs.serverDefaultHide,
        setHidePosterRating,
        loading,
      }}
    >
      <PosterDisplaySettingsContext.Provider value={{ hideLibraryRatingBadge: effectiveHide }}>
        {children}
      </PosterDisplaySettingsContext.Provider>
    </PosterPrefsContext.Provider>
  )
}
