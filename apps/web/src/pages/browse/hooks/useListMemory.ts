import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { rememberList, takeList, type ListSnapshot, type ListTab } from '../listMemory'

type ListState<T> = Omit<ListSnapshot<T>, 'scrollY' | 'savedAt'>

interface UseListMemoryOptions<T> {
  tab: ListTab
  /** This list is the tab on screen: only it owns the window's scroll. */
  active: boolean
  /** Browse was reached by Back/Forward. A fresh visit starts at the top. */
  restore: boolean
  /** The list as it stands, read when Browse is left. */
  current: ListState<T>
}

/**
 * Remember an infinite Browse list when the page is left, and put it back on
 * Back (listMemory.ts says why the items are kept rather than refetched).
 *
 * `takeRemembered(key)` is called by the list's fetch effect with the query it
 * is about to fetch: a matching memory is returned for the caller to show, and
 * the window is scrolled to where it was once those items are on the page.
 * `isShowing(key)` tells the effect the list on screen already answers that
 * query, so a re-run that changes nothing (the range load, a strict-mode
 * double effect) does not throw the restored list away.
 */
export function useListMemory<T>({ tab, active, restore, current }: UseListMemoryOptions<T>) {
  const restoreRef = useRef(restore)
  const activeRef = useRef(active)
  const currentRef = useRef(current)
  const scrollYRef = useRef(0)
  const showingKeyRef = useRef<string | null>(null)
  const [pendingScrollY, setPendingScrollY] = useState<number | null>(null)

  activeRef.current = active
  currentRef.current = current

  // Track the position while on screen. Read at unmount instead and it can be
  // the next page's: a shorter page clamps the window's scroll first.
  useEffect(() => {
    if (!active) return
    const onScroll = () => {
      scrollYRef.current = window.scrollY
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [active])

  useEffect(
    () => () => {
      if (!activeRef.current) return
      const state = currentRef.current
      if (state.items.length === 0) return
      rememberList(tab, { ...state, scrollY: scrollYRef.current, savedAt: Date.now() })
    },
    [tab]
  )

  // In the same commit as the restored items, so the page is tall enough.
  useLayoutEffect(() => {
    if (pendingScrollY == null) return
    window.scrollTo(0, pendingScrollY)
    scrollYRef.current = pendingScrollY
    setPendingScrollY(null)
  }, [pendingScrollY])

  const takeRemembered = useCallback(
    (key: string): ListSnapshot<T> | null => {
      if (!restoreRef.current) return null
      restoreRef.current = false
      const snapshot = takeList<T>(tab, key)
      if (!snapshot) return null
      showingKeyRef.current = key
      if (activeRef.current) setPendingScrollY(snapshot.scrollY)
      return snapshot
    },
    [tab]
  )

  /** Record that the list on screen answers `key` (after a fetch, or null to clear). */
  const markShowing = useCallback((key: string | null) => {
    showingKeyRef.current = key
  }, [])

  const isShowing = useCallback((key: string) => showingKeyRef.current === key, [])

  return { takeRemembered, markShowing, isShowing }
}
