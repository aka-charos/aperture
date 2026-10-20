import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { threadsPathFor } from './labels'

/**
 * The address that opens Follow a thread on `ref`, from wherever the link is
 * drawn. On top of the Trails page itself (a title opened in its dialog) the
 * page's other selections are carried along rather than reset.
 */
export function useThreadsPath(ref: string | null): string | null {
  const { pathname, search } = useLocation()
  const onTrails = pathname.replace(/\/+$/, '') === '/trails'
  return useMemo(
    () => (ref ? threadsPathFor(ref, onTrails ? new URLSearchParams(search) : null) : null),
    [ref, onTrails, search]
  )
}
