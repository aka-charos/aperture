/**
 * The hand-over from a library search to the request panel.
 *
 * What counts as missing is decided by the API (`requestable` on each result and
 * the `missing` summary of `GET /api/seerr/search`, from
 * `routes/seerr/sources/requestability.ts`); the bundle only reads it. Pure
 * (`missingTitles.test.ts`).
 */

/** Shortest query either search answers; the API returns an empty page below it. */
export const CONTENT_SEARCH_MIN_QUERY = 2

/** Pause in typing before the request backend is asked. */
export const CONTENT_SEARCH_DEBOUNCE_MS = 400

/** The API's `missing` summary: titles on this page that could still be requested. */
export interface MissingSummary {
  movies: number
  series: number
  /** Further pages exist, so the real numbers may be higher. */
  more: boolean
}

/** A summary together with the query it was counted for. */
export interface MissingForQuery extends MissingSummary {
  query: string
}

/** Something to offer: at least one title could still be requested. */
export function hasMissing(summary: MissingSummary | null | undefined): summary is MissingSummary {
  return summary != null && summary.movies + summary.series > 0
}

/** The address of My Requests with the search box already filled in. */
export function requestSearchPath(query: string): string {
  return `/my-requests?q=${encodeURIComponent(query.trim())}`
}
