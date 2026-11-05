import { useState, useEffect, useCallback, useRef } from 'react'
import type { DiscoveryCandidate, DiscoveryRun, DiscoveryStatus, MediaType, DiscoveryFilterOptions } from '../types'

// Build query string from filter options
function buildFilterQueryString(filters: DiscoveryFilterOptions): string {
  const params = new URLSearchParams()
  
  if (filters.languages && filters.languages.length > 0) {
    params.set('languages', filters.languages.join(','))
    // Include unknown language setting (only relevant when filtering by language)
    // Default is true, so only pass when explicitly set to false
    if (filters.includeUnknownLanguage === false) {
      params.set('includeUnknownLanguage', 'false')
    }
  }
  if (filters.genreIds && filters.genreIds.length > 0) {
    params.set('genres', filters.genreIds.join(','))
  }
  if (filters.yearStart !== undefined) {
    params.set('yearStart', filters.yearStart.toString())
  }
  if (filters.yearEnd !== undefined) {
    params.set('yearEnd', filters.yearEnd.toString())
  }
  if (filters.minSimilarity !== undefined && filters.minSimilarity > 0) {
    params.set('minSimilarity', filters.minSimilarity.toString())
  }
  
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

// This browser cache held one person's suggestions under a key shared by everyone
// using the browser. It is gone; this clears what older builds left behind.
try {
  localStorage.removeItem('aperture_discovery_cache')
} catch {
  // Storage unavailable: nothing was saved there either.
}

// Minimum target count before triggering expansion
const TARGET_DISPLAY_COUNT = 50
const EXPANSION_THRESHOLD = 20 // Trigger expansion when below this count

// The refresh endpoint answers 202 and runs the pipeline in the background, so
// the page watches the run row instead of holding a request open. Capped at
// four minutes: a cold run on an empty pool is the slow case, and a process
// killed mid-run leaves the row at 'running' with nothing to move it.
const REFRESH_POLL_INTERVAL_MS = 3000
const REFRESH_POLL_ATTEMPTS = 80

export function useDiscoveryData(filters: DiscoveryFilterOptions = {}) {
  const [status, setStatus] = useState<DiscoveryStatus | null>(null)
  const [movieCandidates, setMovieCandidates] = useState<DiscoveryCandidate[]>([])
  const [seriesCandidates, setSeriesCandidates] = useState<DiscoveryCandidate[]>([])
  const [movieRun, setMovieRun] = useState<DiscoveryRun | null>(null)
  const [seriesRun, setSeriesRun] = useState<DiscoveryRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expanding, setExpanding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Track current filters for comparison
  const filtersRef = useRef(filters)
  // Track if we've already tried to expand for current filters
  const expansionAttemptedRef = useRef<string>('')
  // Track expanding state via ref for use in callbacks (avoids stale closure)
  const expandingRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/discovery/status', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setStatus(data)
        return data as DiscoveryStatus
      } else if (response.status === 403) {
        const fallbackStatus = {
          enabled: false,
          requestEnabled: false,
          streamingDiscoveryEnabled: false,
          movieRun: null,
          seriesRun: null,
          movieCount: 0,
          seriesCount: 0,
        }
        setStatus(fallbackStatus)
        return fallbackStatus
      } else {
        setError('Failed to load discovery status')
        return null
      }
    } catch {
      setError('Could not connect to server')
      return null
    }
  }, [])

  const fetchCandidates = useCallback(async (
    mediaType: MediaType,
    filterOpts: DiscoveryFilterOptions = {},
    signal?: AbortSignal
  ): Promise<{ candidates: DiscoveryCandidate[]; run: DiscoveryRun | null } | null> => {
    try {
      const queryString = buildFilterQueryString(filterOpts)
      const response = await fetch(`/api/discovery/${mediaType === 'movie' ? 'movies' : 'series'}${queryString}`, {
        credentials: 'include',
        signal,
      })
      if (response.ok) {
        const data = await response.json()
        // A newer filter took over while this one was on its way.
        if (signal?.aborted) return null
        const candidates = data.candidates || []
        
        if (mediaType === 'movie') {
          setMovieCandidates(candidates)
          setMovieRun(data.run)
        } else {
          setSeriesCandidates(candidates)
          setSeriesRun(data.run)
        }
        
        return { candidates, run: data.run }
      } else if (response.status !== 403) {
        console.error('Failed to load candidates')
      }
      return null
    } catch {
      if (!signal?.aborted) console.error('Could not fetch candidates')
      return null
    }
  }, [])

  const refresh = useCallback(async (mediaType: MediaType) => {
    setRefreshing(true)
    try {
      const response = await fetch(`/api/discovery/refresh/${mediaType === 'movie' ? 'movies' : 'series'}`, {
        method: 'POST',
        credentials: 'include',
      })

      // 202: the run was started in the background. The request no longer waits
      // for the pipeline -- a cold run is minutes -- so poll the run row until
      // it leaves 'running' before refetching. Bounded, because a killed process
      // leaves a run row at 'running' forever and the spinner must not.
      if (response.status === 202) {
        const runKey = mediaType === 'movie' ? 'movieRun' : 'seriesRun'
        for (let attempt = 0; attempt < REFRESH_POLL_ATTEMPTS; attempt++) {
          await new Promise((r) => setTimeout(r, REFRESH_POLL_INTERVAL_MS))
          const statusRes = await fetch('/api/discovery/status', { credentials: 'include' })
          if (!statusRes.ok) break
          const statusData = await statusRes.json()
          const run = statusData?.[runKey]
          if (run && run.status !== 'running') {
            if (run.status === 'failed') {
              return { success: false, error: run.errorMessage || 'Refresh failed' }
            }
            break
          }
        }
      }

      if (response.ok) {
        // Refresh the candidates
        await fetchCandidates('movie')
        await fetchCandidates('series')
        await fetchStatus()

        return { success: true }
      } else {
        const data = await response.json()
        return { success: false, error: data.error || 'Failed to refresh' }
      }
    } catch {
      return { success: false, error: 'Could not connect to server' }
    } finally {
      setRefreshing(false)
    }
  }, [fetchCandidates, fetchStatus])

  /**
   * Expand discovery by dynamically fetching more candidates matching current filters
   * This is called automatically when the filtered count drops below threshold
   */
  const expandDiscovery = useCallback(async (mediaType: MediaType, currentCandidates: DiscoveryCandidate[]) => {
    // Create a key to track if we've already attempted expansion for these filters
    const expansionKey = `${mediaType}-${JSON.stringify(filters)}`
    
    // Don't expand if already expanding, already attempted, or have enough candidates
    if (expandingRef.current) {
      return null
    }
    if (currentCandidates.length >= EXPANSION_THRESHOLD) {
      return null
    }
    if (expansionAttemptedRef.current === expansionKey) {
      return null
    }

    // Mark as attempted BEFORE starting to prevent race conditions
    expansionAttemptedRef.current = expansionKey
    expandingRef.current = true
    setExpanding(true)

    try {
      // Get existing TMDb IDs to exclude from expansion
      const existingTmdbIds = currentCandidates.map(c => c.tmdbId)

      const response = await fetch(`/api/discovery/${mediaType === 'movie' ? 'movies' : 'series'}/expand`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          languages: filters.languages,
          genreIds: filters.genreIds,
          yearStart: filters.yearStart,
          yearEnd: filters.yearEnd,
          excludeTmdbIds: existingTmdbIds,
          targetCount: TARGET_DISPLAY_COUNT - currentCandidates.length,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Discovery] Expand failed:', response.status, errorText)
        return null
      }

      const data = await response.json()
      const newCandidates = data.candidates || []

      if (newCandidates.length === 0) {
        return null
      }

      // Merge new candidates with existing ones
      const merged = [...currentCandidates, ...newCandidates]
      
      // Sort by finalScore descending
      merged.sort((a, b) => b.finalScore - a.finalScore)

      // Update state based on media type
      if (mediaType === 'movie') {
        setMovieCandidates(merged)
      } else {
        setSeriesCandidates(merged)
      }

      return { candidates: merged, added: newCandidates.length }
    } catch (err) {
      console.error('Error expanding discovery:', err)
      // Reset attempted ref on error so user can retry
      expansionAttemptedRef.current = ''
      return null
    } finally {
      expandingRef.current = false
      setExpanding(false)
    }
    // Note: We intentionally don't include `expanding` in deps to prevent callback recreation
    // The `expanding` check uses a ref pattern internally
     
  }, [filters])

  useEffect(() => {
    const filtersChanged = JSON.stringify(filters) !== JSON.stringify(filtersRef.current)
    if (filtersChanged) {
      filtersRef.current = filters
      expansionAttemptedRef.current = ''
    }
  }, [filters])

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoading(true)
      await Promise.all([
        fetchStatus(),
        fetchCandidates('movie', filters, controller.signal),
        fetchCandidates('series', filters, controller.signal),
      ])
      if (!controller.signal.aborted) setLoading(false)
    }
    load()
    return () => controller.abort()
  }, [fetchStatus, fetchCandidates, filters])

  // Auto-expand when filters result in low candidate count
  useEffect(() => {
    const checkAndExpand = async () => {
      // Only expand if filters are active and count is low
      const hasFilters = (filters.languages && filters.languages.length > 0) ||
                        (filters.genreIds && filters.genreIds.length > 0) ||
                        filters.yearStart !== undefined ||
                        filters.yearEnd !== undefined

      if (!hasFilters || loading) {
        return
      }

      // Check movies
      if (movieCandidates.length > 0 && movieCandidates.length < EXPANSION_THRESHOLD) {
        await expandDiscovery('movie', movieCandidates)
      }

      // Check series
      if (seriesCandidates.length > 0 && seriesCandidates.length < EXPANSION_THRESHOLD) {
        await expandDiscovery('series', seriesCandidates)
      }
    }
    
    checkAndExpand()
  }, [filters, loading, movieCandidates, seriesCandidates, expandDiscovery])

  // Refetch candidates (used when job completes externally)
  const refetchCandidates = useCallback(async () => {
    setLoading(true)
    await Promise.all([
      fetchStatus(),
      fetchCandidates('movie', filters),
      fetchCandidates('series', filters),
    ])
    setLoading(false)
  }, [fetchStatus, fetchCandidates, filters])

  return {
    status,
    movieCandidates,
    seriesCandidates,
    movieRun,
    seriesRun,
    loading,
    refreshing,
    expanding,
    error,
    refresh,
    expandDiscovery,
    refetchCandidates,
  }
}

