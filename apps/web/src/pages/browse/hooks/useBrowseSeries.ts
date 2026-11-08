import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { PAGE_SIZE, defaultSeriesFilters } from '../constants'
import type { ListPage } from './listRequests'
import { usePagedList } from './usePagedList'
import type { ActiveFilterChip, ContentRating, CountryOption, FilterRanges, NetworkOption, Series } from '../types'
import type { SeriesFilters, SortField, SortOrder } from '../components'
import { buildSeriesActiveFilterChips } from '../utils/activeFilterChips'
import { withLoadedRange, type SeriesUrlState } from '../urlState'
import { useListMemory } from './useListMemory'

interface UseBrowseSeriesOptions {
  tabIndex: number
  persistSortPreferences: (sortBy: SortField, sortOrder: SortOrder) => void
  /** The selection the URL carried when Browse opened (urlState.ts). */
  initial?: SeriesUrlState
  /** Browse was reached by Back/Forward: put the list back where it was. */
  restore?: boolean
}

interface SeriesResponse {
  series: Series[]
  total: number
}

/** One page of the series list, out of the response body (stable for usePagedList). */
function readSeries(body: unknown): ListPage<Series> {
  const data = body as SeriesResponse
  return { items: data.series, total: data.total }
}

interface BrowseSeriesResult {
  series: Series[]
  seriesGenres: string[]
  networks: NetworkOption[]
  seriesContentRatings: ContentRating[]
  seriesCountries: CountryOption[]
  seriesRanges: FilterRanges & { seasons?: { min: number; max: number } }
  seriesLoading: boolean
  seriesLoadingMore: boolean
  seriesError: string | null
  /** The failure was a later page: show it at the end of the list, not above it. */
  seriesErrorAtEnd: boolean
  /** Ask again for the page that failed (shown with the error). */
  retrySeries: () => void
  seriesSearch: string
  setSeriesSearch: Dispatch<SetStateAction<string>>
  seriesGenre: string
  setSeriesGenre: Dispatch<SetStateAction<string>>
  network: string
  setNetwork: Dispatch<SetStateAction<string>>
  seriesFilters: SeriesFilters
  setSeriesFilters: Dispatch<SetStateAction<SeriesFilters>>
  seriesSortBy: SortField
  setSeriesSortBy: Dispatch<SetStateAction<SortField>>
  seriesSortOrder: SortOrder
  setSeriesSortOrder: Dispatch<SetStateAction<SortOrder>>
  seriesTotal: number
  seriesHasMore: boolean
  seriesLoadMoreRef: RefObject<HTMLDivElement | null>
  activeFilters: ActiveFilterChip[]
  handleSeriesSortChange: (sortBy: SortField, sortOrder: SortOrder) => void
}

export function useBrowseSeries({
  tabIndex,
  persistSortPreferences,
  initial,
  restore = false,
}: UseBrowseSeriesOptions): BrowseSeriesResult {
  const { t } = useTranslation()
  const [seriesGenres, setSeriesGenres] = useState<string[]>([])
  const [networks, setNetworks] = useState<NetworkOption[]>([])
  const [seriesContentRatings, setSeriesContentRatings] = useState<ContentRating[]>([])
  const [seriesCountries, setSeriesCountries] = useState<CountryOption[]>([])
  const [seriesRanges, setSeriesRanges] = useState<FilterRanges & { seasons?: { min: number; max: number } }>({
    year: { min: 1950, max: new Date().getFullYear() },
    seasons: { min: 1, max: 30 },
    rating: { min: 0, max: 10 },
  })
  const [seriesSearch, setSeriesSearch] = useState(initial?.search ?? '')
  const [seriesGenre, setSeriesGenre] = useState(initial?.genre ?? '')
  const [network, setNetwork] = useState(initial?.group ?? '')
  const [seriesFilters, setSeriesFilters] = useState<SeriesFilters>(initial?.filters ?? defaultSeriesFilters)
  const [seriesSortBy, setSeriesSortBy] = useState<SortField>(initial?.sortBy ?? 'title')
  const [seriesSortOrder, setSeriesSortOrder] = useState<SortOrder>(initial?.sortOrder ?? 'asc')
  // Range ends the URL set: loading the library's real extents must keep them.
  const pinnedRangesRef = useRef(initial?.pinned ?? {})
  // The list's API query, without the page number: what the list IS. It keys
  // the fetch effect (so a re-run that would send the same request does not
  // refetch, e.g. the range load leaving every parameter as it was) and the
  // remembered list Back restores (listMemory.ts).
  const listQuery = useMemo(() => {
    const params = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      sortBy: seriesSortBy,
      sortOrder: seriesSortOrder,
    })
    if (seriesSearch) params.set('search', seriesSearch)
    if (seriesGenre) params.set('genre', seriesGenre)
    if (network) params.set('network', network)

    if (seriesFilters.yearRange[0] > seriesRanges.year.min) params.set('minYear', String(seriesFilters.yearRange[0]))
    if (seriesFilters.yearRange[1] < seriesRanges.year.max) params.set('maxYear', String(seriesFilters.yearRange[1]))
    if (seriesFilters.seasonsRange[0] > (seriesRanges.seasons?.min || 1)) params.set('minSeasons', String(seriesFilters.seasonsRange[0]))
    if (seriesFilters.seasonsRange[1] < (seriesRanges.seasons?.max || 30)) params.set('maxSeasons', String(seriesFilters.seasonsRange[1]))
    if (seriesFilters.communityRating[0] > 0) params.set('minCommunityRating', String(seriesFilters.communityRating[0]))
    if (seriesFilters.rtScore[0] > 0) params.set('minRtScore', String(seriesFilters.rtScore[0]))
    if (seriesFilters.metacritic[0] > 0) params.set('minMetacritic', String(seriesFilters.metacritic[0]))
    seriesFilters.contentRatings.forEach((rating) => params.append('contentRating', rating))
    seriesFilters.status.forEach((status) => params.append('status', status))
    seriesFilters.countries.forEach((country) => params.append('country', country))
    if (seriesFilters.countries.length > 1) params.set('countryMatch', seriesFilters.countryMatch)
    if (seriesFilters.countries.length > 0) {
      params.set('countryScope', seriesFilters.includeSecondaryCountries ? 'any' : 'primary')
    }
    if (seriesFilters.watchStatus !== 'any') params.set('watchStatus', seriesFilters.watchStatus)
    if (seriesFilters.minWatchers !== null && seriesFilters.minWatchers > 0) params.set('minWatchers', String(seriesFilters.minWatchers))
    if (seriesFilters.maxWatchers !== null && seriesFilters.maxWatchers >= 0) params.set('maxWatchers', String(seriesFilters.maxWatchers))
    return params.toString()
  }, [network, seriesFilters, seriesGenre, seriesRanges, seriesSearch, seriesSortBy, seriesSortOrder])

  const pageUrl = useCallback((page: number) => `/api/series?${listQuery}&page=${page}`, [listQuery])
  // markShowing comes from the list memory below; the shared hook reads the
  // latest through a ref, so a forward reference here is safe.
  const markShowingRef = useRef<(key: string | null) => void>(() => {})
  const list = usePagedList<Series>({
    key: listQuery,
    active: tabIndex === 1,
    pageUrl,
    read: readSeries,
    failedKey: 'browse.errors.loadSeries',
    onFirstPage: () => markShowingRef.current(listQuery),
  })
  const { items: series, page: seriesPage, total: seriesTotal, hasMore: seriesHasMore } = list.state

  const memory = useListMemory<Series>({
    tab: 'series',
    active: tabIndex === 1,
    restore,
    current: { key: listQuery, items: series, page: seriesPage, total: seriesTotal, hasMore: seriesHasMore },
  })
  const markShowing = memory.markShowing
  markShowingRef.current = markShowing

  const fetchSeriesMetadata = useCallback(async () => {
    try {
      const [genresRes, networksRes, contentRatingsRes, countriesRes, rangesRes] = await Promise.all([
        fetch('/api/series/genres', { credentials: 'include' }),
        fetch('/api/series/networks', { credentials: 'include' }),
        fetch('/api/series/content-ratings', { credentials: 'include' }),
        fetch('/api/series/countries', { credentials: 'include' }),
        fetch('/api/series/filter-ranges', { credentials: 'include' }),
      ])

      if (genresRes.ok) {
        const data = (await genresRes.json()) as { genres?: string[] }
        setSeriesGenres(data.genres || [])
      }
      if (networksRes.ok) {
        const data = (await networksRes.json()) as { networks?: NetworkOption[] }
        setNetworks(data.networks || [])
      }
      if (contentRatingsRes.ok) {
        const data = (await contentRatingsRes.json()) as { contentRatings?: ContentRating[] }
        setSeriesContentRatings(data.contentRatings || [])
      }
      if (countriesRes.ok) {
        const data = (await countriesRes.json()) as { countries?: CountryOption[] }
        setSeriesCountries(data.countries || [])
      }
      if (rangesRes.ok) {
        const data = (await rangesRes.json()) as FilterRanges & { seasons?: { min: number; max: number } }
        setSeriesRanges(data)
        setSeriesFilters((prev) => ({
          ...prev,
          yearRange: withLoadedRange(prev.yearRange, [data.year.min, data.year.max], pinnedRangesRef.current.yearRange),
          seasonsRange: withLoadedRange(
            prev.seasonsRange,
            [data.seasons?.min || 1, data.seasons?.max || 30],
            pinnedRangesRef.current.seasonsRange
          ),
        }))
      }
    } catch {
      // Ignore metadata errors.
    }
  }, [])

  useEffect(() => {
    void fetchSeriesMetadata()
  }, [fetchSeriesMetadata])

  const { takeRemembered, isShowing } = memory
  const { reset: resetList, restore: restoreList, load: loadPage } = list
  useEffect(() => {
    // Already showing this query (restored, or a re-run that changed nothing).
    if (isShowing(listQuery)) return
    const remembered = takeRemembered(listQuery)
    if (remembered) {
      restoreList(remembered)
      return
    }
    resetList()
    markShowing(null)
    const debounce = setTimeout(() => {
      void loadPage(1, false)
    }, seriesSearch ? 300 : 0)
    return () => clearTimeout(debounce)
  }, [isShowing, listQuery, loadPage, markShowing, resetList, restoreList, seriesSearch, takeRemembered])

  const activeFilters = useMemo(
    () =>
      buildSeriesActiveFilterChips({
        seriesGenre,
        network,
        seriesFilters,
        seriesRanges,
        t,
        setSeriesGenre,
        setNetwork,
        setSeriesFilters,
      }),
    [network, seriesFilters, seriesGenre, seriesRanges, t]
  )

  const handleSeriesSortChange = useCallback(
    (sortBy: SortField, sortOrder: SortOrder) => {
      setSeriesSortBy(sortBy)
      setSeriesSortOrder(sortOrder)
      persistSortPreferences(sortBy, sortOrder)
    },
    [persistSortPreferences]
  )

  return {
    retrySeries: list.retry,
    seriesErrorAtEnd: list.state.error?.during === 'more',
    series,
    seriesGenres,
    networks,
    seriesContentRatings,
    seriesCountries,
    seriesRanges,
    seriesLoading: list.state.loading,
    seriesLoadingMore: list.state.loadingMore,
    seriesError: list.state.error?.message ?? null,
    seriesSearch,
    setSeriesSearch,
    seriesGenre,
    setSeriesGenre,
    network,
    setNetwork,
    seriesFilters,
    setSeriesFilters,
    seriesSortBy,
    setSeriesSortBy,
    seriesSortOrder,
    setSeriesSortOrder,
    seriesTotal,
    seriesHasMore,
    seriesLoadMoreRef: list.loadMoreRef,
    activeFilters,
    handleSeriesSortChange,
  }
}
