import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { PAGE_SIZE } from '../constants'
import { afterListPage, loadListPage } from './listRequests'
import { useListRequests } from './useListRequests'
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

interface BrowsePeopleResult {
  people: BrowsePerson[]
  peopleLoading: boolean
  peopleLoadingMore: boolean
  peopleError: string | null
  peopleSearch: string
  setPeopleSearch: Dispatch<SetStateAction<string>>
  peopleSortBy: PeopleSortBy
  setPeopleSortBy: Dispatch<SetStateAction<PeopleSortBy>>
  peopleHasMore: boolean
  peopleTotal: number
  peopleLoadMoreRef: RefObject<HTMLDivElement | null>
}

export function useBrowsePeople({ tabIndex, initialTabIsPeople, initial }: UseBrowsePeopleOptions): BrowsePeopleResult {
  const { t } = useTranslation()
  const [people, setPeople] = useState<BrowsePerson[]>([])
  const [peopleLoading, setPeopleLoading] = useState(() => initialTabIsPeople)
  const [peopleLoadingMore, setPeopleLoadingMore] = useState(false)
  const [peopleError, setPeopleError] = useState<string | null>(null)
  const [peopleSearch, setPeopleSearch] = useState(initial?.search ?? '')
  const [peopleSortBy, setPeopleSortBy] = useState<PeopleSortBy>(initial?.sortBy ?? 'credits')
  const [peoplePage, setPeoplePage] = useState(1)
  const [peopleHasMore, setPeopleHasMore] = useState(true)
  const [peopleTotal, setPeopleTotal] = useState(0)
  const peopleObserverRef = useRef<IntersectionObserver | null>(null)
  const peopleLoadMoreRef = useRef<HTMLDivElement | null>(null)
  // Loaded-count lives in a ref, not state: putting people.length in fetchPeople's
  // deps recreates the callback after every fetch, and the fetch effect depends
  // on fetchPeople — an infinite refetch loop (grid flickers content/skeleton).
  const peopleCountRef = useRef(0)

  const resetPeople = useCallback(() => {
    setPeople([])
    setPeoplePage(1)
    setPeopleHasMore(true)
    peopleCountRef.current = 0
  }, [])

  // A reply is applied only while its request is current (listRequests.ts). The
  // key changes whenever the fetch effect below starts a new list, the tab
  // included: it returns early off the People tab and starts over on return.
  const requests = useListRequests(
    tabIndex === 2 ? `${peopleSortBy}\n${peopleSearch}` : null,
    () => setPeopleLoadingMore(false)
  )

  const fetchPeople = useCallback(
    async (page: number, append = false) => {
      if (append) setPeopleLoadingMore(true)
      else setPeopleLoading(true)

      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortBy: peopleSortBy,
      })
      if (peopleSearch) params.set('search', peopleSearch)

      const outcome = await loadListPage({
        guard: requests,
        url: `/api/discover/people?${params}`,
        append,
        read: (body) => {
          const data = body as PeopleResponse
          return { items: data.people, total: data.total }
        },
      })
      // Superseded: the request that replaced it owns the list and its flags.
      if (outcome.kind === 'stale') return

      if (outcome.kind === 'page') {
        const { items, total } = outcome.page
        if (append) setPeople((prev) => [...prev, ...items])
        else setPeople(items)
        const next = afterListPage(peopleCountRef.current, items.length, total, append, PAGE_SIZE)
        peopleCountRef.current = next.loaded
        setPeopleTotal(total)
        setPeopleHasMore(next.hasMore)
        setPeopleError(null)
      } else {
        setPeopleError(t(outcome.kind === 'failed' ? 'browse.errors.loadPeople' : 'browse.errors.connect'))
      }
      setPeopleLoading(false)
      setPeopleLoadingMore(false)
    },
    [peopleSearch, peopleSortBy, requests, t]
  )

  useEffect(() => {
    if (tabIndex !== 2) return
    resetPeople()
    const debounce = setTimeout(() => {
      void fetchPeople(1, false)
    }, peopleSearch ? 300 : 0)
    return () => clearTimeout(debounce)
  }, [fetchPeople, peopleSearch, peopleSortBy, resetPeople, tabIndex])

  useEffect(() => {
    if (peopleObserverRef.current) {
      peopleObserverRef.current.disconnect()
    }

    if (!peopleHasMore || peopleLoading || peopleLoadingMore || tabIndex !== 2) return

    peopleObserverRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && peopleHasMore && !peopleLoadingMore) {
          const nextPage = peoplePage + 1
          setPeoplePage(nextPage)
          void fetchPeople(nextPage, true)
        }
      },
      { threshold: 0.1 }
    )

    if (peopleLoadMoreRef.current) {
      peopleObserverRef.current.observe(peopleLoadMoreRef.current)
    }

    return () => {
      if (peopleObserverRef.current) {
        peopleObserverRef.current.disconnect()
      }
    }
  }, [fetchPeople, peopleHasMore, peopleLoading, peopleLoadingMore, peoplePage, tabIndex])

  return {
    people,
    peopleLoading,
    peopleLoadingMore,
    peopleError,
    peopleSearch,
    setPeopleSearch,
    peopleSortBy,
    setPeopleSortBy,
    peopleHasMore,
    peopleTotal,
    peopleLoadMoreRef,
  }
}
