import { useEffect, useState } from 'react'

/** A library title as `/api/search` returns it (already scoped to the viewer). */
export interface LibrarySearchHit {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  poster_url: string | null
}

interface LibraryTitleSearchOptions {
  limit?: number
  /** False skips the search and answers nothing, e.g. while a box shows the title already chosen. */
  enabled?: boolean
}

/** Shorter than this is not a search; one letter matches half the library. */
const MIN_TERM_LENGTH = 2
const DEBOUNCE_MS = 250

/**
 * Library titles matching what someone is typing: debounced, and a reply to an
 * older term is dropped (its request aborted) so a slow early answer cannot
 * land over a fast later one. A failed lookup answers nothing rather than
 * raising a banner, which is what every picker built on it wants.
 */
export function useLibraryTitleSearch(term: string, options: LibraryTitleSearchOptions = {}) {
  const { limit = 10, enabled = true } = options
  const [hits, setHits] = useState<LibrarySearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const trimmed = term.trim()

  useEffect(() => {
    if (!enabled || trimmed.length < MIN_TERM_LENGTH) {
      setHits([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}&type=all&limit=${limit}`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((json: { results?: LibrarySearchHit[] } | null) => {
          setHits(json?.results ?? [])
          setLoading(false)
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setHits([])
            setLoading(false)
          }
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, limit, enabled])

  return { hits, loading, tooShort: trimmed.length < MIN_TERM_LENGTH }
}
