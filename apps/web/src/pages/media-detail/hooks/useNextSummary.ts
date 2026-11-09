import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchNext } from '../../next/api'
import type { NextItem, NextSummaryResponse } from '../../next/types'

export type NextSummaryStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface NextSummaryState {
  status: NextSummaryStatus
  /** The best few suggestions after this title; only when `status` is `ready`. */
  items: NextItem[] | null
  /** Ask, unless an answer is already here or on its way. After a failure it asks again. */
  load: () => void
}

type Entry = { ref: string; status: 'loading' | 'failed' } | { ref: string; status: 'ready'; items: NextItem[] }

/**
 * The few best suggestions after one title, from Next from here, asked only
 * when someone points at or opens the tab: the request can be the one that
 * builds the credits index, and most people opening a title never look.
 * Keyed by title, so an answer for the title shown before is never shown for
 * this one, and a later success replaces an earlier failure.
 */
export function useNextSummary(titleRef: string | null): NextSummaryState {
  const [entry, setEntry] = useState<Entry | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  // Leaving the title (or the page) ends its request.
  useEffect(() => () => controllerRef.current?.abort(), [titleRef])

  const current = entry != null && entry.ref === titleRef ? entry : null

  const load = useCallback(() => {
    if (!titleRef) return
    if (current && current.status !== 'failed') return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setEntry({ ref: titleRef, status: 'loading' })
    fetchNext<NextSummaryResponse>(`summary?title=${encodeURIComponent(titleRef)}`, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setEntry({ ref: titleRef, status: 'ready', items: response.items })
      })
      .catch(() => {
        // An abort is this title being left, not a failure to report.
        if (!controller.signal.aborted) setEntry({ ref: titleRef, status: 'failed' })
      })
  }, [titleRef, current])

  return {
    status: current?.status ?? 'idle',
    items: current?.status === 'ready' ? current.items : null,
    load,
  }
}
