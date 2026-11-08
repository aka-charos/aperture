import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { PAGE_SIZE, defaultMovieFilters } from '../constants'
import type { ListPage } from './listRequests'
import { usePagedList } from './usePagedList'
import type {
  ActiveFilterChip,
  Collection,
  ContentRating,
  CountryOption,
  FilterRanges,
  Movie,
  Resolution,
} from '../types'
import type { MovieFilters, SortField, SortOrder } from '../components'
import { buildMovieActiveFilterChips } from '../utils/activeFilterChips'
import { withLoadedRange, type MovieUrlState } from '../urlState'
import { useListMemory } from './useListMemory'

interface UseBrowseMoviesOptions {
  tabIndex: number
  persistSortPreferences: (sortBy: SortField, sortOrder: SortOrder) => void
  /** The selection the URL carried when Browse opened (urlState.ts). */
  initial?: MovieUrlState
  /** Browse was reached by Back/Forward: put the list back where it was. */
  restore?: boolean
}

interface MoviesResponse {
  movies: Movie[]
  total: number
}

/** One page of the movie list, out of the response body (stable for usePagedList). */
function readMovies(body: unknown): ListPage<Movie> {
  const data = body as MoviesResponse
  return { items: data.movies, total: data.total }
}

interface MovieMetadataResponse {
  genres?: string[]
  collections?: Collection[]
  contentRatings?: ContentRating[]
  resolutions?: Resolution[]
  countries?: CountryOption[]
}

interface MovieRangesResponse extends FilterRanges {
  runtime?: { min: number; max: number }
}

interface BrowseMoviesResult {
  movies: Movie[]
  movieGenres: string[]
  collections: Collection[]
  movieContentRatings: ContentRating[]
  movieResolutions: Resolution[]
  movieCountries: CountryOption[]
  movieRanges: MovieRangesResponse
  moviesLoading: boolean
  moviesLoadingMore: boolean
  moviesError: string | null
  /** The failure was a later page: show it at the end of the list, not above it. */
  moviesErrorAtEnd: boolean
  /** Ask again for the page that failed (shown with the error). */
  retryMovies: () => void
  movieSearch: string
  setMovieSearch: Dispatch<SetStateAction<string>>
  movieGenre: string
  setMovieGenre: Dispatch<SetStateAction<string>>
  collection: string
  setCollection: Dispatch<SetStateAction<string>>
  movieFilters: MovieFilters
  setMovieFilters: Dispatch<SetStateAction<MovieFilters>>
  movieSortBy: SortField
  setMovieSortBy: Dispatch<SetStateAction<SortField>>
  movieSortOrder: SortOrder
  setMovieSortOrder: Dispatch<SetStateAction<SortOrder>>
  movieTotal: number
  movieHasMore: boolean
  movieLoadMoreRef: RefObject<HTMLDivElement | null>
  activeFilters: ActiveFilterChip[]
  handleMovieSortChange: (sortBy: SortField, sortOrder: SortOrder) => void
}

export function useBrowseMovies({
  tabIndex,
  persistSortPreferences,
  initial,
  restore = false,
}: UseBrowseMoviesOptions): BrowseMoviesResult {
  const { t } = useTranslation()
  const [movieGenres, setMovieGenres] = useState<string[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [movieContentRatings, setMovieContentRatings] = useState<ContentRating[]>([])
  const [movieResolutions, setMovieResolutions] = useState<Resolution[]>([])
  const [movieCountries, setMovieCountries] = useState<CountryOption[]>([])
  const [movieRanges, setMovieRanges] = useState<MovieRangesResponse>({
    year: { min: 1900, max: new Date().getFullYear() },
    runtime: { min: 0, max: 300 },
    rating: { min: 0, max: 10 },
  })
  const [movieSearch, setMovieSearch] = useState(initial?.search ?? '')
  const [movieGenre, setMovieGenre] = useState(initial?.genre ?? '')
  const [collection, setCollection] = useState(initial?.group ?? '')
  const [movieFilters, setMovieFilters] = useState<MovieFilters>(initial?.filters ?? defaultMovieFilters)
  const [movieSortBy, setMovieSortBy] = useState<SortField>(initial?.sortBy ?? 'title')
  const [movieSortOrder, setMovieSortOrder] = useState<SortOrder>(initial?.sortOrder ?? 'asc')
  // Range ends the URL set: loading the library's real extents must keep them.
  const pinnedRangesRef = useRef(initial?.pinned ?? {})
  // The list's API query, without the page number: what the list IS. It keys
  // the fetch effect (so a re-run that would send the same request does not
  // refetch, e.g. the range load leaving every parameter as it was) and the
  // remembered list Back restores (listMemory.ts).
  const listQuery = useMemo(() => {
    const params = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      sortBy: movieSortBy,
      sortOrder: movieSortOrder,
    })
    if (movieSearch) params.set('search', movieSearch)
    if (movieGenre) params.set('genre', movieGenre)
    if (collection) params.set('collection', collection)

    if (movieFilters.yearRange[0] > movieRanges.year.min) params.set('minYear', String(movieFilters.yearRange[0]))
    if (movieFilters.yearRange[1] < movieRanges.year.max) params.set('maxYear', String(movieFilters.yearRange[1]))
    if (movieFilters.runtimeRange[0] > (movieRanges.runtime?.min || 0)) params.set('minRuntime', String(movieFilters.runtimeRange[0]))
    if (movieFilters.runtimeRange[1] < (movieRanges.runtime?.max || 300)) params.set('maxRuntime', String(movieFilters.runtimeRange[1]))
    if (movieFilters.communityRating[0] > 0) params.set('minCommunityRating', String(movieFilters.communityRating[0]))
    if (movieFilters.rtScore[0] > 0) params.set('minRtScore', String(movieFilters.rtScore[0]))
    if (movieFilters.metacritic[0] > 0) params.set('minMetacritic', String(movieFilters.metacritic[0]))
    movieFilters.contentRatings.forEach((rating) => params.append('contentRating', rating))
    movieFilters.resolutions.forEach((resolution) => params.append('resolution', resolution))
    movieFilters.countries.forEach((country) => params.append('country', country))
    if (movieFilters.countries.length > 1) params.set('countryMatch', movieFilters.countryMatch)
    if (movieFilters.countries.length > 0) {
      params.set('countryScope', movieFilters.includeSecondaryCountries ? 'any' : 'primary')
    }
    if (movieFilters.watchStatus !== 'any') params.set('watchStatus', movieFilters.watchStatus)
    if (movieFilters.minWatchers !== null && movieFilters.minWatchers > 0) params.set('minWatchers', String(movieFilters.minWatchers))
    if (movieFilters.maxWatchers !== null && movieFilters.maxWatchers >= 0) params.set('maxWatchers', String(movieFilters.maxWatchers))
    return params.toString()
  }, [collection, movieFilters, movieGenre, movieRanges, movieSearch, movieSortBy, movieSortOrder])

  const pageUrl = useCallback((page: number) => `/api/movies?${listQuery}&page=${page}`, [listQuery])
  // markShowing comes from the list memory below; the shared hook reads the
  // latest through a ref, so a forward reference here is safe.
  const markShowingRef = useRef<(key: string | null) => void>(() => {})
  const list = usePagedList<Movie>({
    key: listQuery,
    active: tabIndex === 0,
    pageUrl,
    read: readMovies,
    failedKey: 'browse.errors.loadMovies',
    onFirstPage: () => markShowingRef.current(listQuery),
  })
  const { items: movies, page: moviePage, total: movieTotal, hasMore: movieHasMore } = list.state

  const memory = useListMemory<Movie>({
    tab: 'movies',
    active: tabIndex === 0,
    restore,
    current: { key: listQuery, items: movies, page: moviePage, total: movieTotal, hasMore: movieHasMore },
  })
  const markShowing = memory.markShowing
  markShowingRef.current = markShowing

  const fetchMovieMetadata = useCallback(async () => {
    try {
      const [genresRes, collectionsRes, contentRatingsRes, resolutionsRes, countriesRes, rangesRes] = await Promise.all([
        fetch('/api/movies/genres', { credentials: 'include' }),
        fetch('/api/movies/collections', { credentials: 'include' }),
        fetch('/api/movies/content-ratings', { credentials: 'include' }),
        fetch('/api/movies/resolutions', { credentials: 'include' }),
        fetch('/api/movies/countries', { credentials: 'include' }),
        fetch('/api/movies/filter-ranges', { credentials: 'include' }),
      ])

      if (genresRes.ok) {
        const data = (await genresRes.json()) as { genres?: string[] }
        setMovieGenres(data.genres || [])
      }
      if (collectionsRes.ok) {
        const data = (await collectionsRes.json()) as MovieMetadataResponse
        setCollections(data.collections || [])
      }
      if (contentRatingsRes.ok) {
        const data = (await contentRatingsRes.json()) as MovieMetadataResponse
        setMovieContentRatings(data.contentRatings || [])
      }
      if (resolutionsRes.ok) {
        const data = (await resolutionsRes.json()) as MovieMetadataResponse
        setMovieResolutions(data.resolutions || [])
      }
      if (countriesRes.ok) {
        const data = (await countriesRes.json()) as MovieMetadataResponse
        setMovieCountries(data.countries || [])
      }
      if (rangesRes.ok) {
        const data = (await rangesRes.json()) as MovieRangesResponse
        setMovieRanges(data)
        setMovieFilters((prev) => ({
          ...prev,
          yearRange: withLoadedRange(prev.yearRange, [data.year.min, data.year.max], pinnedRangesRef.current.yearRange),
          runtimeRange: withLoadedRange(
            prev.runtimeRange,
            [data.runtime?.min || 0, data.runtime?.max || 300],
            pinnedRangesRef.current.runtimeRange
          ),
        }))
      }
    } catch {
      // Ignore metadata errors.
    }
  }, [])

  useEffect(() => {
    void fetchMovieMetadata()
  }, [fetchMovieMetadata])

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
    }, movieSearch ? 300 : 0)
    return () => clearTimeout(debounce)
  }, [isShowing, listQuery, loadPage, markShowing, movieSearch, resetList, restoreList, takeRemembered])

  const activeFilters = useMemo(
    () =>
      buildMovieActiveFilterChips({
        movieGenre,
        collection,
        movieFilters,
        movieRanges,
        t,
        setMovieGenre,
        setCollection,
        setMovieFilters,
      }),
    [collection, movieFilters, movieGenre, movieRanges, t]
  )

  const handleMovieSortChange = useCallback(
    (sortBy: SortField, sortOrder: SortOrder) => {
      setMovieSortBy(sortBy)
      setMovieSortOrder(sortOrder)
      persistSortPreferences(sortBy, sortOrder)
    },
    [persistSortPreferences]
  )

  return {
    retryMovies: list.retry,
    moviesErrorAtEnd: list.state.error?.during === 'more',
    movies,
    movieGenres,
    collections,
    movieContentRatings,
    movieResolutions,
    movieCountries,
    movieRanges,
    moviesLoading: list.state.loading,
    moviesLoadingMore: list.state.loadingMore,
    moviesError: list.state.error?.message ?? null,
    movieSearch,
    setMovieSearch,
    movieGenre,
    setMovieGenre,
    collection,
    setCollection,
    movieFilters,
    setMovieFilters,
    movieSortBy,
    setMovieSortBy,
    movieSortOrder,
    setMovieSortOrder,
    movieTotal,
    movieHasMore,
    movieLoadMoreRef: list.loadMoreRef,
    activeFilters,
    handleMovieSortChange,
  }
}
