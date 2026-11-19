import { useCallback, useEffect, useState } from 'react'
import { nextQuery } from '../../next/reasons'
import type { NextFromHereResponse } from '../../next/types'

export interface NextMapState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  data: NextFromHereResponse | null
  retry: () => void
}

type Entry = { ref: string; status: 'loading' | 'failed' } | { ref: string; status: 'ready'; data: NextFromHereResponse }

/**
 * Next from here's whole answer for one title, which the map is drawn from
 * (its titles and the lines between them). Asked the first time someone
 * switches the panel to the map, then kept for the title.
 *
 * The request belongs to the title, not to the view: switching back to the
 * list while it is on its way must not cancel it, or switching to the map
 * again would find it "loading" with nothing behind it.
 */
export function useNextMap(titleRef: string | null, wanted: boolean): NextMapState {
  const [entry, setEntry] = useState<Entry | null>(null)
  const [askedFor, setAskedFor] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (wanted && titleRef && askedFor !== titleRef) setAskedFor(titleRef)
  }, [wanted, titleRef, askedFor])

  useEffect(() => {
    if (!askedFor) return
    const controller = new AbortController()
    setEntry({ ref: askedFor, status: 'loading' })
    fetch(`/api/next-from-here${nextQuery([askedFor])}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Next from here failed (${response.status})`)
        const data = (await response.json()) as NextFromHereResponse
        if (!controller.signal.aborted) setEntry({ ref: askedFor, status: 'ready', data })
      })
      .catch(() => {
        if (!controller.signal.aborted) setEntry({ ref: askedFor, status: 'failed' })
      })
    return () => controller.abort()
  }, [askedFor, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const current = entry != null && entry.ref === titleRef ? entry : null

  return {
    status: current?.status ?? 'idle',
    data: current?.status === 'ready' ? current.data : null,
    retry,
  }
}
