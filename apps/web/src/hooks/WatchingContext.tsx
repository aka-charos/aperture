/**
 * WatchingProvider
 *
 * Provider for managing the user's "Shows You Watch" list state.
 * Includes caching with 1-day TTL to avoid slow re-fetches of enrichment data.
 */

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { WATCHING_CACHE_KEY } from '@/lib/clientCaches'
import { useAuth } from './useAuth'
import { readWatchingCache, serializeWatchingCache } from './watchingCache'
import {
  WatchingContext,
  type WatchingRefreshResult,
  type WatchingSeries,
} from './watching-context'

const CACHE_KEY = WATCHING_CACHE_KEY
/** Watchlist membership only — history-sourced rows must not count as "watching" */
function watchlistIds(series: WatchingSeries[]): Set<string> {
  return new Set(series.filter((s) => s.inWatchlist).map((s) => s.seriesId))
}

interface WatchingProviderProps {
  children: ReactNode
}

/** This viewer's cached list, or null. Anything else in the slot is dropped. */
function getCache(userId: string | null): WatchingSeries[] | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    const series = readWatchingCache<WatchingSeries>(cached, userId, Date.now())
    if (!series && cached) localStorage.removeItem(CACHE_KEY)
    return series
  } catch {
    return null
  }
}

function setCache(userId: string | null, series: WatchingSeries[]): void {
  if (!userId) return
  try {
    localStorage.setItem(CACHE_KEY, serializeWatchingCache(series, userId, Date.now()))
  } catch (err) {
    console.warn('Failed to cache watching data:', err)
  }
}

function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // Ignore errors
  }
}

export function WatchingProvider({ children }: WatchingProviderProps) {
  const [series, setSeries] = useState<WatchingSeries[]>([])
  const [watchingIds, setWatchingIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const { user } = useAuth()
  const userId = user?.id ?? null
  const fetchedForRef = useRef<string | null>(null)

  // Fetch full watching data
  const fetchWatchingData = useCallback(async (useCache = true) => {
    // Check cache first
    if (useCache) {
      const cached = getCache(userId)
      if (cached) {
        setSeries(cached)
        setWatchingIds(watchlistIds(cached))
        setLoading(false)
        return
      }
    }

    try {
      const response = await fetch('/api/watching', { credentials: 'include' })
      if (!response.ok) {
        throw new Error('Failed to load watching list')
      }
      const data = await response.json()
      setSeries(data.series)
      setWatchingIds(watchlistIds(data.series))
      setError(null)

      // Cache the result
      setCache(userId, data.series)
    } catch (err) {
      console.error('Failed to fetch watching data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load watching list')
    } finally {
      setLoading(false)
    }
  }, [userId])

  // Initial fetch, and again for a different viewer
  useEffect(() => {
    if (fetchedForRef.current !== userId) {
      fetchedForRef.current = userId
      fetchWatchingData(true)
    }
  }, [fetchWatchingData, userId])

  const isWatching = useCallback((seriesId: string) => {
    return watchingIds.has(seriesId)
  }, [watchingIds])

  const addToWatching = useCallback(async (seriesId: string) => {
    // Optimistic update for IDs
    setWatchingIds((prev) => new Set([...prev, seriesId]))

    try {
      const response = await fetch(`/api/watching/${seriesId}`, {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        // Revert on failure
        setWatchingIds((prev) => {
          const next = new Set(prev)
          next.delete(seriesId)
          return next
        })
        throw new Error('Failed to add to watching list')
      }

      // Clear cache and refetch to get enriched data for the new series
      clearCache()
      await fetchWatchingData(false)
    } catch (err) {
      console.error('Failed to add to watching:', err)
      throw err
    }
  }, [fetchWatchingData])

  const removeFromWatching = useCallback(async (seriesId: string) => {
    // Optimistic update — history-sourced rows stay visible, just leave the watchlist
    setWatchingIds((prev) => {
      const next = new Set(prev)
      next.delete(seriesId)
      return next
    })
    setSeries((prev) =>
      prev.flatMap((s) => {
        if (s.seriesId !== seriesId) return [s]
        return s.inHistory ? [{ ...s, inWatchlist: false, addedAt: null }] : []
      })
    )

    try {
      const response = await fetch(`/api/watching/${seriesId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        // Revert on failure
        setWatchingIds((prev) => new Set([...prev, seriesId]))
        await fetchWatchingData(false)
        throw new Error('Failed to remove from watching list')
      }

      // Update cache with new series list
      setSeries((current) => {
        setCache(userId, current)
        return current
      })
    } catch (err) {
      console.error('Failed to remove from watching:', err)
      throw err
    }
  }, [fetchWatchingData, userId])

  const toggleWatching = useCallback(async (seriesId: string) => {
    if (watchingIds.has(seriesId)) {
      await removeFromWatching(seriesId)
    } else {
      await addToWatching(seriesId)
    }
  }, [watchingIds, addToWatching, removeFromWatching])

  const refresh = useCallback(async () => {
    setLoading(true)
    clearCache()
    await fetchWatchingData(false)
  }, [fetchWatchingData])

  const refreshLibrary = useCallback(async () => {
    setRefreshing(true)
    try {
      const response = await fetch('/api/watching/refresh', {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to refresh library')
      }

      const data = (await response.json()) as WatchingRefreshResult
      return data
    } catch (err) {
      console.error('Failed to refresh library:', err)
      throw err
    } finally {
      setRefreshing(false)
    }
  }, [])

  const value = {
    watchingIds,
    series,
    loading,
    error,
    refreshing,
    isWatching,
    addToWatching,
    removeFromWatching,
    toggleWatching,
    refresh,
    refreshLibrary,
  }

  return (
    <WatchingContext.Provider value={value}>
      {children}
    </WatchingContext.Provider>
  )
}
