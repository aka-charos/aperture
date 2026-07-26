import { useState, useCallback, useEffect } from 'react'
import type { MediaSummary, MediaType } from '../types'

interface UseMediaSearchOptions {
  enabled?: boolean
  debounceMs?: number
}

/**
 * Debounced library search for channel seed pickers. `kind` selects the endpoint — /api/movies or
 * /api/series — both of which return the fields MediaSummary needs under their own response key.
 */
export function useMediaSearch(kind: MediaType, options: UseMediaSearchOptions = {}) {
  const { enabled = true, debounceMs = 300 } = options
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MediaSummary[]>([])
  const [isSearching, setIsSearching] = useState(false)

  const search = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery || searchQuery.length < 2) {
        setResults([])
        return
      }

      setIsSearching(true)
      try {
        const path = kind === 'series' ? '/api/series' : '/api/movies'
        const response = await fetch(
          `${path}?search=${encodeURIComponent(searchQuery)}&pageSize=10`,
          { credentials: 'include' }
        )
        if (response.ok) {
          const data = await response.json()
          setResults((kind === 'series' ? data.series : data.movies) || [])
        }
      } catch {
        console.error(`Failed to search ${kind}`)
      } finally {
        setIsSearching(false)
      }
    },
    [kind]
  )

  useEffect(() => {
    if (!enabled) return

    const timer = setTimeout(() => {
      search(query)
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [query, search, enabled, debounceMs])

  const clear = useCallback(() => {
    setQuery('')
    setResults([])
  }, [])

  return {
    query,
    setQuery,
    results,
    isSearching,
    clear,
  }
}
