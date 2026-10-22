import { useEffect, useRef, useState } from 'react'
import { useWatchStatus } from './useWatchStatus'

/**
 * A number that moves whenever the viewer's watched set does: a page whose
 * answers leave out watched titles keys them by it, so a title marked watched
 * (in the detail dialog, say) leaves what is on screen. Its first load is not
 * a change, so the revision starts at 0 and stays there until the set moves
 * after that. Used by Trails and Next from here.
 */
export function useWatchedRevision(): number {
  const { watchedMovies, loading } = useWatchStatus()
  const [revision, setRevision] = useState(0)
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (loading) return
    if (seen.current && seen.current !== watchedMovies) setRevision((current) => current + 1)
    seen.current = watchedMovies
  }, [watchedMovies, loading])
  return revision
}
