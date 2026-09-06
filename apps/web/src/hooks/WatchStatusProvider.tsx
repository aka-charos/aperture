/**
 * WatchStatusProvider
 *
 * Which titles the viewer has finished, fetched once per page load and read by
 * every poster grid in the app (the tick MoviePoster draws in its top-right
 * corner).
 *
 * One whole-library answer rather than a `watched` flag on each of the ten list
 * endpoints that feed those grids: ten copies of the predicate is how they come
 * to disagree, and a card would then claim different things about the same film
 * on two pages. The set is the same shape and roughly the same size as the one
 * UserRatingsProvider already holds.
 *
 * Not cached in localStorage on purpose. A stale tick is a claim about the
 * viewer that is wrong on first paint, which is worse than the flash of a
 * missing badge, and it would need a place in `clientCaches.ts` for the
 * assumed-session edges.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { WatchStatusContext } from './watch-status-context'
import { onMovieWatched } from '@/lib/watchStatusEvents'

const key = (type: 'movie' | 'series', id: string) => `${type}-${id}`

export function WatchStatusProvider({ children }: { children: ReactNode }) {
  const [watched, setWatchedSet] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const fetchWatched = async () => {
      try {
        const response = await fetch('/api/watch-status', { credentials: 'include' })
        if (!response.ok) throw new Error('Failed to fetch watch status')
        const data = (await response.json()) as { movieIds?: string[]; seriesIds?: string[] }
        if (cancelled) return
        const next = new Set<string>()
        for (const id of data.movieIds ?? []) next.add(key('movie', id))
        for (const id of data.seriesIds ?? []) next.add(key('series', id))
        setWatchedSet(next)
      } catch (err) {
        // A failed fetch leaves every poster unticked, which is the safe
        // direction: it understates what the viewer has seen instead of
        // claiming they watched something they did not.
        console.error('Failed to fetch watch status:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchWatched()
    return () => {
      cancelled = true
    }
  }, [])

  const isWatched = useCallback(
    (type: 'movie' | 'series', id: string): boolean => watched.has(key(type, id)),
    [watched]
  )

  const setWatched = useCallback((type: 'movie' | 'series', id: string, value: boolean) => {
    setWatchedSet((prev) => {
      const k = key(type, id)
      if (prev.has(k) === value) return prev
      const next = new Set(prev)
      if (value) next.add(k)
      else next.delete(k)
      return next
    })
  }, [])

  // The watch-date prompt writes a play from up near the root, on a surface the
  // grid below cannot see. Same event the media detail page listens to.
  useEffect(() => onMovieWatched(({ movieId }) => setWatched('movie', movieId, true)), [setWatched])

  return (
    <WatchStatusContext.Provider value={{ watched, isWatched, setWatched, loading }}>
      {children}
    </WatchStatusContext.Provider>
  )
}
