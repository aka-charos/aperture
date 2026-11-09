/**
 * What the Search page holds in its address: the query and every filter.
 *
 * The address is the page's record, so reload, back/forward and a link all
 * land on the same search. One reader and one writer, shared by the page and
 * the search dialog's "view all", so a filter added here reaches all of them.
 * Pure, pinned by `searchUrlState.test.ts`.
 */

export type SearchType = 'all' | 'movie' | 'series'

export interface SearchUrlState {
  q: string
  type: SearchType
  genre: string
  collection: string
  network: string
  /** 0 = any. */
  minRtScore: number
  semantic: boolean
  /** null = no bound on that side. */
  yearMin: number | null
  yearMax: number | null
}

export const SEARCH_PATH = '/search'

const TYPES: readonly SearchType[] = ['all', 'movie', 'series']

/** A whole number in [min, max], or null for absent or unreadable text. */
function readInt(text: string | null, min: number, max: number): number | null {
  if (text == null || !/^\s*-?\d+\s*$/.test(text)) return null
  const value = Number(text)
  return value >= min && value <= max ? value : null
}

/** Unreadable values fall back to "no filter", never to something sent on. */
export function readSearchState(params: URLSearchParams): SearchUrlState {
  const type = params.get('type')
  const yearMin = readInt(params.get('yearMin'), 1800, 9999)
  const yearMax = readInt(params.get('yearMax'), 1800, 9999)
  const crossed = yearMin != null && yearMax != null && yearMin > yearMax
  return {
    q: params.get('q') ?? '',
    type: TYPES.includes(type as SearchType) ? (type as SearchType) : 'all',
    genre: params.get('genre') ?? '',
    collection: params.get('collection') ?? '',
    network: params.get('network') ?? '',
    minRtScore: readInt(params.get('minRtScore'), 0, 100) ?? 0,
    semantic: params.get('semantic') === 'true',
    yearMin: crossed ? yearMax : yearMin,
    yearMax: crossed ? yearMin : yearMax,
  }
}

/** Only what differs from "no filter", in one fixed order. */
export function searchStateParams(state: SearchUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.q) params.set('q', state.q)
  if (state.type !== 'all') params.set('type', state.type)
  if (state.genre) params.set('genre', state.genre)
  if (state.collection) params.set('collection', state.collection)
  if (state.network) params.set('network', state.network)
  if (state.minRtScore > 0) params.set('minRtScore', String(state.minRtScore))
  if (state.yearMin != null) params.set('yearMin', String(state.yearMin))
  if (state.yearMax != null) params.set('yearMax', String(state.yearMax))
  if (state.semantic) params.set('semantic', 'true')
  return params
}

/**
 * Whether the page takes over an address it has just been given. Its own
 * writes are replace navigations holding what it already shows; reading one
 * back could land late and undo a keystroke. A push (a search started
 * elsewhere) or back/forward is taken over.
 */
export function adoptsAddress(navigationType: 'POP' | 'PUSH' | 'REPLACE'): boolean {
  return navigationType !== 'REPLACE'
}

/**
 * Where the search dialog's "view all" goes. From the Search page itself the
 * new text replaces the query and the filters chosen there stay.
 */
export function viewAllPath(query: string, current: { pathname: string; search: string }): string {
  const base: SearchUrlState =
    current.pathname === SEARCH_PATH
      ? readSearchState(new URLSearchParams(current.search))
      : readSearchState(new URLSearchParams())
  return `${SEARCH_PATH}?${searchStateParams({ ...base, q: query })}`
}
