import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { PAGE_SIZE } from '../constants'
import type { ListPage } from './listRequests'
import { usePagedList } from './usePagedList'
import type { BrowsePerson } from '../types'
import type { PeopleUrlState } from '../urlState'

type PeopleSortBy = 'name' | 'credits'

interface UseBrowsePeopleOptions {
  tabIndex: number
  initialTabIsPeople: boolean
  /** The search and sort the URL carried when Browse opened (urlState.ts). */
  initial?: PeopleUrlState
}

interface PeopleResponse {
  people: BrowsePerson[]
  total: number
}

/** One page of the people list, out of the response body (stable for usePagedList). */
function readPeople(body: unknown): ListPage<BrowsePerson> {
  const data = body as PeopleResponse
  return { items: data.people, total: data.total }
}

interface BrowsePeopleResult {
  people: BrowsePerson[]
  peopleLoading: boolean
  peopleLoadingMore: boolean
  peopleError: string | null
  /** The failure was a later page: show it at the end of the list, not above it. */
  peopleErrorAtEnd: boolean
  /** Ask again for the page that failed (shown with the error). */
  retryPeople: () => void
  peopleSearch: string
  setPeopleSearch: Dispatch<SetStateAction<string>>
  peopleSortBy: PeopleSortBy
  setPeopleSortBy: Dispatch<SetStateAction<PeopleSortBy>>
  peopleHasMore: boolean
  peopleTotal: number
  peopleLoadMoreRef: RefObject<HTMLDivElement | null>
}

export function useBrowsePeople({ tabIndex, initialTabIsPeople, initial }: UseBrowsePeopleOptions): BrowsePeopleResult {
  const [peopleSearch, setPeopleSearch] = useState(initial?.search ?? '')
  const [peopleSortBy, setPeopleSortBy] = useState<PeopleSortBy>(initial?.sortBy ?? 'credits')
  const onTab = tabIndex === 2

  const pageUrl = useCallback(
    (page: number) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortBy: peopleSortBy })
      if (peopleSearch) params.set('search', peopleSearch)
      return `/api/discover/people?${params}`
    },
    [peopleSearch, peopleSortBy]
  )

  // The key changes whenever the effect below starts a new list, the tab
  // included: it does nothing off the People tab and starts over on return.
  const list = usePagedList<BrowsePerson>({
    key: onTab ? `${peopleSortBy}\n${peopleSearch}` : null,
    active: onTab,
    pageUrl,
    read: readPeople,
    failedKey: 'browse.errors.loadPeople',
    initialLoading: initialTabIsPeople,
  })

  const { reset: resetList, load: loadPage } = list
  useEffect(() => {
    if (!onTab) return
    resetList()
    const debounce = setTimeout(() => {
      void loadPage(1, false)
    }, peopleSearch ? 300 : 0)
    return () => clearTimeout(debounce)
  }, [loadPage, onTab, peopleSearch, resetList])

  return {
    people: list.state.items,
    peopleLoading: list.state.loading,
    peopleLoadingMore: list.state.loadingMore,
    peopleError: list.state.error?.message ?? null,
    peopleErrorAtEnd: list.state.error?.during === 'more',
    retryPeople: list.retry,
    peopleSearch,
    setPeopleSearch,
    peopleSortBy,
    setPeopleSortBy,
    peopleHasMore: list.state.hasMore,
    peopleTotal: list.state.total,
    peopleLoadMoreRef: list.loadMoreRef,
  }
}
