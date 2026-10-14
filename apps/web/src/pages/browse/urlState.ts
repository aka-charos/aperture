/**
 * Browse's selection, written into the URL and read back from it.
 *
 * The URL is the record, so going back to Browse from a title restores exactly
 * what was on screen. Only the ACTIVE tab's selection is written (the tabs
 * share one set of names), and only what differs from a default, so a bare
 * visit stays `/browse`. Reading is defensive: anything malformed or unknown is
 * ignored rather than trusted, because a URL is something people edit and paste.
 *
 * Pure, so the round trip is pinned by a test (urlState.test.ts).
 */
import type { MovieFilters, SeriesFilters, SortField, SortOrder } from './components'
import { defaultMovieFilters, defaultSeriesFilters } from './constants'

export type BrowseTab = 'movies' | 'series' | 'people'
export type PeopleSort = 'name' | 'credits'
type Range = [number, number]

/** Which end of a range came from the URL, so loading the real range keeps it. */
export interface PinnedRange {
  min: boolean
  max: boolean
}

interface MediaUrlState<F> {
  search: string
  genre: string
  /** Franchise (movies) or network (series). */
  group: string
  filters: F
  /** Absent when the URL did not say, so a saved sort preference applies. */
  sortBy?: SortField
  sortOrder?: SortOrder
  pinned: Partial<Record<string, PinnedRange>>
}

export type MovieUrlState = MediaUrlState<MovieFilters>
export type SeriesUrlState = MediaUrlState<SeriesFilters>

export interface PeopleUrlState {
  search: string
  sortBy?: PeopleSort
}

export interface BrowseUrlState {
  tab: BrowseTab | null
  movies: MovieUrlState
  series: SeriesUrlState
  people: PeopleUrlState
}

/** Range fields and their parameter names. */
const RANGE_KEYS: Record<string, [string, string]> = {
  yearRange: ['minYear', 'maxYear'],
  runtimeRange: ['minRuntime', 'maxRuntime'],
  seasonsRange: ['minSeasons', 'maxSeasons'],
  communityRating: ['minRating', 'maxRating'],
  rtScore: ['minRt', 'maxRt'],
  metacritic: ['minMc', 'maxMc'],
}

/** Ranges whose full extent is fixed rather than read from the library. */
const FIXED_RANGES: Record<string, Range> = {
  communityRating: [0, 10],
  rtScore: [0, 100],
  metacritic: [0, 100],
}

/** List fields and their (repeated) parameter names. */
const LIST_KEYS: Record<string, string> = {
  contentRatings: 'contentRating',
  resolutions: 'resolution',
  countries: 'country',
  status: 'status',
}

const MOVIE_SORTS: readonly SortField[] = ['title', 'year', 'releaseDate', 'rating', 'rtScore', 'metacritic', 'runtime', 'added']
const SERIES_SORTS: readonly SortField[] = ['title', 'year', 'rating', 'rtScore', 'metacritic', 'seasons', 'added']
const PEOPLE_SORTS: readonly PeopleSort[] = ['name', 'credits']

function parseNumber(raw: string | null): number | undefined {
  if (raw == null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function parseTab(raw: string | null): BrowseTab | null {
  return raw === 'movies' || raw === 'series' || raw === 'people' ? raw : null
}

function readFilters<F extends MovieFilters | SeriesFilters>(
  params: URLSearchParams,
  defaults: F
): { filters: F; pinned: Partial<Record<string, PinnedRange>> } {
  const filters = { ...defaults } as Record<string, unknown>
  const pinned: Partial<Record<string, PinnedRange>> = {}

  for (const [field, [minKey, maxKey]] of Object.entries(RANGE_KEYS)) {
    if (!(field in defaults)) continue
    const base = defaults[field as keyof F] as unknown as Range
    const min = parseNumber(params.get(minKey))
    const max = parseNumber(params.get(maxKey))
    if (min === undefined && max === undefined) continue
    const lo = min ?? base[0]
    const hi = max ?? base[1]
    // A reversed pair is a hand-edited URL; it cannot be shown, so drop it.
    if (lo > hi) continue
    filters[field] = [lo, hi]
    pinned[field] = { min: min !== undefined, max: max !== undefined }
  }

  for (const [field, key] of Object.entries(LIST_KEYS)) {
    if (!(field in defaults)) continue
    const values = [...new Set(params.getAll(key).map((v) => v.trim()).filter(Boolean))]
    if (values.length > 0) filters[field] = values
  }

  const match = params.get('countryMatch')
  if (match === 'all' || match === 'any') filters.countryMatch = match
  if (params.get('secondary') === '1') filters.includeSecondaryCountries = true
  const watch = params.get('watch')
  if (watch === 'watched' || watch === 'unwatched') filters.watchStatus = watch
  for (const key of ['minWatchers', 'maxWatchers'] as const) {
    const n = parseNumber(params.get(key))
    if (n !== undefined && n >= 0) filters[key] = Math.floor(n)
  }

  return { filters: filters as F, pinned }
}

function readMedia<F extends MovieFilters | SeriesFilters>(
  params: URLSearchParams,
  defaults: F,
  groupKey: string,
  sorts: readonly SortField[]
): MediaUrlState<F> {
  const { filters, pinned } = readFilters(params, defaults)
  const sortBy = params.get('sortBy')
  const sortOrder = params.get('sortOrder')
  return {
    search: params.get('q') ?? '',
    genre: params.get('genre') ?? '',
    group: params.get(groupKey) ?? '',
    filters,
    sortBy: sorts.includes(sortBy as SortField) ? (sortBy as SortField) : undefined,
    sortOrder: sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : undefined,
    pinned,
  }
}

/**
 * Read a Browse URL. Each tab's state is read only when that tab is the one
 * the URL names (movies is the default), since the tabs share parameter names.
 */
export function readBrowseUrl(params: URLSearchParams): BrowseUrlState {
  const tab = parseTab(params.get('tab'))
  const empty = new URLSearchParams()
  const forMovies = tab === null || tab === 'movies' ? params : empty
  const forSeries = tab === 'series' ? params : empty
  const forPeople = tab === 'people' ? params : empty
  const peopleSort = forPeople.get('sortBy')
  return {
    tab,
    movies: readMedia(forMovies, defaultMovieFilters, 'collection', MOVIE_SORTS),
    series: readMedia(forSeries, defaultSeriesFilters, 'network', SERIES_SORTS),
    people: {
      search: forPeople.get('q') ?? '',
      sortBy: PEOPLE_SORTS.includes(peopleSort as PeopleSort) ? (peopleSort as PeopleSort) : undefined,
    },
  }
}

/** The library's loaded extents, for deciding which ranges are narrowed. */
export interface LoadedRanges {
  year: { min: number; max: number }
  runtime?: { min: number; max: number }
  seasons?: { min: number; max: number }
}

function fullRange(field: string, ranges: LoadedRanges): Range | undefined {
  if (FIXED_RANGES[field]) return FIXED_RANGES[field]
  if (field === 'yearRange') return [ranges.year.min, ranges.year.max]
  if (field === 'runtimeRange' && ranges.runtime) return [ranges.runtime.min, ranges.runtime.max]
  if (field === 'seasonsRange' && ranges.seasons) return [ranges.seasons.min, ranges.seasons.max]
  return undefined
}

function writeFilters(params: URLSearchParams, filters: MovieFilters | SeriesFilters, ranges: LoadedRanges): void {
  const record = filters as unknown as Record<string, unknown>
  for (const [field, [minKey, maxKey]] of Object.entries(RANGE_KEYS)) {
    if (!(field in record)) continue
    const value = record[field] as Range
    const full = fullRange(field, ranges)
    if (!full) continue
    if (value[0] !== full[0]) params.set(minKey, String(value[0]))
    if (value[1] !== full[1]) params.set(maxKey, String(value[1]))
  }
  for (const [field, key] of Object.entries(LIST_KEYS)) {
    const values = record[field]
    if (Array.isArray(values)) for (const v of values) params.append(key, String(v))
  }
  if (filters.countries.length > 1 && filters.countryMatch === 'all') params.set('countryMatch', 'all')
  if (filters.countries.length > 0 && filters.includeSecondaryCountries) params.set('secondary', '1')
  if (filters.watchStatus !== 'any') params.set('watch', filters.watchStatus)
  if (filters.minWatchers !== null) params.set('minWatchers', String(filters.minWatchers))
  if (filters.maxWatchers !== null) params.set('maxWatchers', String(filters.maxWatchers))
}

export interface MediaSnapshot<F> {
  search: string
  genre: string
  group: string
  filters: F
  sortBy: SortField
  sortOrder: SortOrder
  ranges: LoadedRanges
}

/**
 * The query string for what is on screen. Sort is always written: it is the
 * one value whose absence means "use my saved preference", so the URL must say
 * which sort it was showing or a return visit could come back in another order.
 */
export function writeBrowseUrl(
  tab: BrowseTab,
  state: {
    movies: MediaSnapshot<MovieFilters>
    series: MediaSnapshot<SeriesFilters>
    people: { search: string; sortBy: PeopleSort }
  }
): string {
  const params = new URLSearchParams()
  params.set('tab', tab)
  if (tab === 'people') {
    if (state.people.search) params.set('q', state.people.search)
    params.set('sortBy', state.people.sortBy)
    return params.toString()
  }
  const media = tab === 'movies' ? state.movies : state.series
  if (media.search) params.set('q', media.search)
  if (media.genre) params.set('genre', media.genre)
  if (media.group) params.set(tab === 'movies' ? 'collection' : 'network', media.group)
  writeFilters(params, media.filters, media.ranges)
  params.set('sortBy', media.sortBy)
  params.set('sortOrder', media.sortOrder)
  return params.toString()
}

/**
 * Merge a freshly loaded library range into a range filter, keeping any end the
 * URL set. Loading used to reset both ends to the full extent, which is exactly
 * what would wipe a restored selection the moment the page finished loading.
 */
export function withLoadedRange(current: Range, loaded: Range, pinned: PinnedRange | undefined): Range {
  return [pinned?.min ? current[0] : loaded[0], pinned?.max ? current[1] : loaded[1]]
}
