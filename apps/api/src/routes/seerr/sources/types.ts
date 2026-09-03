/**
 * Content search: the shape Aperture answers in, and the contract a source
 * has to satisfy to produce it.
 *
 * The point of this file is that the *route* owns the vocabulary, not
 * whichever backend answered. Seerr speaks `mediaType: 'tv'`, camelCased
 * `posterPath`, and availability as the integers 1-5; Aperture speaks
 * `'series'` and decided strings. If Seerr's vocabulary reached the web
 * bundle, adding a second source later would mean changing the page, its
 * types and possibly its translations — rather than adding one file here.
 *
 * Same reasoning (and the same shape) as the web-search source registry in
 * `assistant/discovery/sources/`: several possible backends, one result type,
 * each able to stand in for the other.
 */

/** Availability of a title, as a decided value rather than a provider code. */
export type ContentAvailability =
  | 'unknown'
  | 'pending'
  | 'processing'
  | 'partially_available'
  | 'available'

export interface ContentSearchItem {
  tmdbId: number
  mediaType: 'movie' | 'series' | 'person'
  title: string
  year: number | null
  overview: string | null
  /** TMDb-relative paths. The client joins them to the image base. */
  posterPath: string | null
  backdropPath: string | null
  profilePath: string | null
  voteAverage: number | null
  availability: ContentAvailability
  requested: boolean
  requestStatus: 'pending' | 'approved' | 'declined' | null
  /** Person results: a few titles they are known for, for disambiguation. */
  knownFor: string[]
}

export interface ContentSearchPage {
  page: number
  totalPages: number
  totalResults: number
  results: ContentSearchItem[]
}

export interface ContentSearchSource {
  id: 'seerr' | 'tmdb'
  /** Whether this source can answer right now (configured, enabled, reachable). */
  isAvailable(): Promise<boolean>
  /** Throws on failure; the caller decides whether to fall through or report. */
  search(query: string, page: number): Promise<ContentSearchPage>
}
