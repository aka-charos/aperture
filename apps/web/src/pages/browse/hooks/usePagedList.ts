import { useCallback, useEffect, useReducer, useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { PAGE_SIZE } from '../constants'
import { loadListPage, type ListPage } from './listRequests'
import {
  initialPagedList,
  nextPageRequest,
  pagedListReducer,
  retryRequest,
  shouldLoadMore,
  type PagedListState,
} from './pagedList'
import { useListRequests } from './useListRequests'

interface UsePagedListOptions<T> {
  /**
   * What the list shows (its query); a change ends every request still in
   * flight (useListRequests). Null while the list is not being shown.
   */
  key: string | null
  /** Only a visible list loads more as it is scrolled. */
  active: boolean
  /** The address of one page. A new function whenever the query changes. */
  pageUrl: (page: number) => string
  /** The page's rows and total, out of the response body. Keep it stable. */
  read: (body: unknown) => ListPage<T>
  /** Translation key for "the server answered with an error". */
  failedKey: string
  /** Whether the list starts out waiting for page one. */
  initialLoading?: boolean
  /** After page one arrived (the movie and series lists record what they show). */
  onFirstPage?: () => void
}

export interface PagedList<T> {
  state: PagedListState<T>
  /** The element at the end of the list; reaching it loads the next page. */
  loadMoreRef: RefObject<HTMLDivElement | null>
  load: (page: number, append: boolean) => Promise<void>
  /** Empty the list before asking for a new one; clears the old error. */
  reset: () => void
  restore: (snapshot: { items: T[]; page: number; total: number; hasMore: boolean }) => void
  /** Ask again for the page that failed. */
  retry: () => void
}

/**
 * One Browse list's pages: requests through the shared loader and guard
 * (listRequests.ts), state through the pure reducer (pagedList.ts), and the
 * observer at the end of the list. The movie, series and people hooks own
 * WHAT is asked for and when a new list starts; this owns HOW it pages.
 */
export function usePagedList<T>({
  key,
  active,
  pageUrl,
  read,
  failedKey,
  initialLoading = true,
  onFirstPage,
}: UsePagedListOptions<T>): PagedList<T> {
  const { t } = useTranslation()
  const [state, dispatch] = useReducer(
    pagedListReducer<T>,
    initialLoading,
    (loading: boolean) => initialPagedList<T>(loading)
  )
  const guard = useListRequests(key, () => dispatch({ type: 'cancelled' }))
  const onFirstPageRef = useRef(onFirstPage)
  onFirstPageRef.current = onFirstPage

  const load = useCallback(
    async (page: number, append: boolean) => {
      dispatch({ type: 'request', append })
      const outcome = await loadListPage({ guard, url: pageUrl(page), append, read })
      // Superseded: the request that replaced it owns the list and its flags.
      if (outcome.kind === 'stale') return
      if (outcome.kind === 'page') {
        dispatch({ type: 'page', append, page, ...outcome.page, pageSize: PAGE_SIZE })
        if (!append) onFirstPageRef.current?.()
        return
      }
      dispatch({
        type: 'failure',
        append,
        message: t(outcome.kind === 'failed' ? failedKey : 'browse.errors.connect'),
      })
    },
    [failedKey, guard, pageUrl, read, t]
  )

  const reset = useCallback(() => dispatch({ type: 'reset' }), [])
  const restore = useCallback<PagedList<T>['restore']>((snapshot) => dispatch({ type: 'restore', ...snapshot }), [])

  const retry = useCallback(() => {
    const next = retryRequest(state)
    void load(next.page, next.append)
  }, [load, state])

  // Reaching the end of the list asks for the next page, but only while
  // nothing failed (pagedList.ts says why).
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const observe = shouldLoadMore(state, active)
  const nextPage = nextPageRequest(state).page
  useEffect(() => {
    const target = loadMoreRef.current
    if (!observe || !target) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        // Once: the request flips `loadingMore`, which rebuilds this effect.
        observer.disconnect()
        void load(nextPage, true)
      },
      { threshold: 0.1 }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [load, nextPage, observe])

  return { state, loadMoreRef, load, reset, restore, retry }
}
