import { useCallback, useEffect, useState } from 'react'
import { fetchTrails } from '../../trails/api'
import type { Thread, ThreadsResponse } from '../../trails/types'

/** Threads the detail page shows; the rest are a click away on the Trails page. */
export const STRONGEST_LINKS_SHOWN = 3

/** How far below the screen the card starts loading, so it is ready when reached. */
const PRELOAD_MARGIN = '300px'

export interface StrongestLinks {
  /** The strongest threads, once loaded for this title. */
  threads: Thread[]
  /** Every thread out of the title. */
  total: number
}

export interface StrongestLinksState {
  /** The answer for this title; null while unasked, loading or after a failure. */
  links: StrongestLinks | null
  /** True only once Trails has answered that this title links to nothing. */
  knownEmpty: boolean
  /** Attach to the element whose arrival on screen should start the request. */
  watch: (element: HTMLElement | null) => void
}

/**
 * The strongest named links out of one title, from Trails. Asked only once the
 * card's place on the page comes near the screen: the request can be the one
 * that builds the Trails index, and most people opening a title never scroll
 * that far. Held by the page rather than the card so the hero can drop its
 * Trails link once the answer says there is nothing to follow.
 */
export function useStrongestLinks(titleRef: string | null): StrongestLinksState {
  const [element, setElement] = useState<HTMLElement | null>(null)
  // The title whose card has come near the screen; a new title asks again.
  const [reached, setReached] = useState<string | null>(null)
  const [answer, setAnswer] = useState<({ ref: string } & StrongestLinks) | null>(null)

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
    fetchTrails<ThreadsResponse>(
      `threads?title=${encodeURIComponent(titleRef)}&limit=${STRONGEST_LINKS_SHOWN}&members=0`,
      controller.signal
    )
      .then((response) => setAnswer({ ref: titleRef, threads: response.threads, total: response.total }))
      .catch(() => {
        /* fails quietly: no card, and the hero keeps its link */
      })
    return () => controller.abort()
  }, [titleRef, reached])

  const watch = useCallback((node: HTMLElement | null) => setElement(node), [])
  // An answer for the title shown before is not one for this title.
  const current = answer != null && answer.ref === titleRef ? answer : null
  return {
    links: current ? { threads: current.threads, total: current.total } : null,
    knownEmpty: current != null && current.total === 0,
    watch,
  }
}
