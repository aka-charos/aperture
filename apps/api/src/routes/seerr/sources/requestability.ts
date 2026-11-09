/**
 * Which content-search results can still be requested, and how many — decided
 * here, so the request panel's buttons and the library search's banner read one
 * answer instead of each re-deriving it in the browser.
 *
 * Pure: no runtime imports (`requestability.test.ts`).
 */

export interface RequestabilityInput {
  mediaType: 'movie' | 'series' | 'person'
  inLibrary: boolean
  availability: string
  requested: boolean
}

/**
 * A Request control belongs on this result: a title Aperture's library does not
 * hold and the request backend does not already have. One already requested
 * still shows its control, disabled and saying so; `isStillRequestable` is the
 * narrower question.
 */
export function isRequestable(item: Omit<RequestabilityInput, 'requested'>): boolean {
  return item.mediaType !== 'person' && !item.inLibrary && item.availability !== 'available'
}

/** Requestable and nobody has asked for it yet: pressing Request would do something. */
export function isStillRequestable(item: RequestabilityInput): boolean {
  return isRequestable(item) && !item.requested
}

export interface MissingSummary {
  movies: number
  series: number
  /**
   * The counts cover the page answered. With more pages behind it the real
   * numbers may be higher, and the banner says "at least".
   */
  more: boolean
}

export function summarizeMissing(results: RequestabilityInput[], totalPages: number, page: number): MissingSummary {
  let movies = 0
  let series = 0
  for (const item of results) {
    if (!isStillRequestable(item)) continue
    if (item.mediaType === 'movie') movies++
    else series++
  }
  return { movies, series, more: totalPages > page }
}
