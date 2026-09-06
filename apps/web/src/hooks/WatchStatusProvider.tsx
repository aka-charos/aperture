/**
 * WatchStatusProvider
 *
 * How far the viewer has got with everything, fetched once per page load and
 * read by every poster grid in the app — the tick MoviePoster draws on a
 * finished title, and the `8/24` pill on a series in progress.
 *
 * One whole-library answer rather than a `watched` flag on each of the ten list
 * endpoints that feed those grids: ten copies of the predicate is how they come
 * to disagree, and a card would then claim different things about the same show
 * on two pages. The set is the same shape and roughly the same size as the one
 * UserRatingsProvider already holds.
 *
 * Not cached in localStorage on purpose. A stale tick is a claim about the
 * viewer that is wrong on first paint, which is worse than the flash of a
 * missing badge, and it would need a place in `clientCaches.ts` for the
 * assumed-session edges.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { WatchStatusContext, type EpisodeProgress } from './watch-status-context'
import { onMovieWatched } from '@/lib/watchStatusEvents'

interface WatchStatusResponse {
  movieIds?: string[]
  series?: Array<{ id: string; watched: number; total: number }>
}

export function WatchStatusProvider({ children }: { children: ReactNode }) {
  const [watchedMovies, setWatchedMovies] = useState<Set<string>>(new Set())
  const [seriesProgress, setSeriesProgress] = useState<Map<string, EpisodeProgress>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const fetchWatchStatus = async () => {
      try {
        const response = await fetch('/api/watch-status', { credentials: 'include' })
        if (!response.ok) throw new Error('Failed to fetch watch status')
        const data = (await response.json()) as WatchStatusResponse
        if (cancelled) return
        setWatchedMovies(new Set(data.movieIds ?? []))
        setSeriesProgress(
          new Map((data.series ?? []).map((s) => [s.id, { watched: s.watched, total: s.total }]))
        )
      } catch (err) {
        // A failed fetch leaves every poster bare, which is the safe direction:
        // it understates what the viewer has seen instead of claiming they
        // watched something they did not.
        console.error('Failed to fetch watch status:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchWatchStatus()
    return () => {
      cancelled = true
    }
  }, [])

  const isWatched = useCallback(
    (type: 'movie' | 'series', id: string): boolean => {
      if (type === 'movie') return watchedMovies.has(id)
      const progress = seriesProgress.get(id)
      return progress != null && progress.total > 0 && progress.watched >= progress.total
    },
    [watchedMovies, seriesProgress]
  )

  const getEpisodeProgress = useCallback(
    (type: 'movie' | 'series', id: string): EpisodeProgress | undefined =>
      type === 'series' ? seriesProgress.get(id) : undefined,
    [seriesProgress]
  )

  const setMovieWatched = useCallback((id: string, value: boolean) => {
    setWatchedMovies((prev) => {
      if (prev.has(id) === value) return prev
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  // The watch-date prompt writes a play from up near the root, on a surface the
  // grid below cannot see. Same event the media detail page listens to.
  useEffect(
    () => onMovieWatched(({ movieId }) => setMovieWatched(movieId, true)),
    [setMovieWatched]
  )

  return (
    <WatchStatusContext.Provider
      value={{
        watchedMovies,
        seriesProgress,
        isWatched,
        getEpisodeProgress,
        setMovieWatched,
        loading,
      }}
    >
      {children}
    </WatchStatusContext.Provider>
  )
}
