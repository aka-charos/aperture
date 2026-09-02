/**
 * The bucket a reader clicked, in the terms the breakdown route understands.
 *
 * `label` is what the page already showed them; carrying it means the dialog
 * heading is the same words as the thing they clicked, rather than a second
 * description of it that can drift.
 */
export interface BreakdownRequest {
  dimension:
    | 'genre'
    | 'seriesGenre'
    | 'decade'
    | 'rating'
    | 'actor'
    | 'director'
    | 'studio'
    | 'network'
    | 'month'
    | 'day'
    | 'timeOfDay'
    | 'movies'
    | 'series'
    | 'favorites'
    | 'rewatched'
  value?: string
  value2?: string
  label: string
  /**
   * Where the full picture lives, when the bucket also has a page of its own —
   * a person's whole filmography rather than the part of it you watched. The
   * dialog answers "which of these did I watch"; this is the way out to
   * "what else is there".
   */
  moreHref?: string
  moreLabel?: string
}

export interface BreakdownItem {
  id: string
  mediaType: 'movie' | 'series'
  title: string
  year: number | null
  poster: string | null
  rating: number | null
  playCount: number | null
  episodesWatched: number | null
  lastPlayedAt: string | null
}
