import { useCallback, useEffect, useState } from 'react'
import { fetchNext } from '../../next/api'
import type { NextItem, NextSummaryResponse } from '../../next/types'

/** How far below the screen the request starts, so the tab opens ready. */
const PRELOAD_MARGIN = '300px'

export interface NextSummaryState {
  /** The best few suggestions after this title; null while unasked, loading or after a failure. */
  items: NextItem[] | null
  /** The request for this title failed. Opening another title asks again. */
  failed: boolean
  /** Attach to the element whose arrival on screen should start the request. */
  watch: (element: HTMLElement | null) => void
}

/**
 * The few best suggestions after one title, from Next from here. Asked only
 * once the related-titles column comes near the screen: the request can be the
 * one that builds the credits index, and most people opening a title never
 * scroll that far. Asked before its tab is opened, so the tab opens ready.
 */
export function useNextSummary(titleRef: string | null): NextSummaryState {
  const [element, setElement] = useState<HTMLElement | null>(null)
  // The title whose column has come near the screen; a new title asks again.
  const [reached, setReached] = useState<string | null>(null)
  const [answer, setAnswer] = useState<{ ref: string; items: NextItem[] } | null>(null)
  const [failedRef, setFailedRef] = useState<string | null>(null)

  useEffect(() => {
    if (!titleRef || reached === titleRef) return
    if (typeof IntersectionObserver === 'undefined') {
      setReached(titleRef)
      return
    }
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setReached(titleRef)
      },
      { rootMargin: PRELOAD_MARGIN }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, titleRef, reached])

  useEffect(() => {
    if (!titleRef || reached !== titleRef) return
    const controller = new AbortController()
    fetchNext<NextSummaryResponse>(`summary?title=${encodeURIComponent(titleRef)}`, controller.signal)
      .then((response) => setAnswer({ ref: titleRef, items: response.items }))
      .catch(() => {
        // An abort is this title being left, not a failure to report.
        if (!controller.signal.aborted) setFailedRef(titleRef)
      })
    return () => controller.abort()
  }, [titleRef, reached])

  const watch = useCallback((node: HTMLElement | null) => setElement(node), [])
  // An answer for the title shown before is not one for this title.
  return {
    items: answer != null && answer.ref === titleRef ? answer.items : null,
    failed: titleRef != null && failedRef === titleRef,
    watch,
  }
}
