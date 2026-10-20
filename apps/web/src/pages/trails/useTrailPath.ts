import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { trailPathFor } from './labels'

/**
 * The address that starts a trail at `ref`, from wherever the link is drawn.
 * On top of the Trails page itself (a title opened in its dialog) the page's
 * filters are carried along rather than reset.
 */
export function useTrailPath(ref: string | null): string | null {
  const { pathname, search } = useLocation()
  const onTrails = pathname.replace(/\/+$/, '') === '/trails'
  return useMemo(
    () => (ref ? trailPathFor(ref, onTrails ? new URLSearchParams(search) : null) : null),
    [ref, onTrails, search]
  )
}
