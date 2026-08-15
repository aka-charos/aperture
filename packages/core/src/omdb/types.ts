/**
 * OMDb API Types
 */

// ============================================================================
// API Response Types
// ============================================================================

export interface OMDbRating {
  Source: string
  Value: string
}

export interface OMDbMovieResponse {
  Response: 'True' | 'False'
  Error?: string
  Title: string
  Year: string
  Rated: string
  Released: string
  Runtime: string
  Genre: string
  Director: string
  Writer: string
  Actors: string
  Plot: string
  Language: string
  Country: string
  Awards: string
  Poster: string
  Ratings: OMDbRating[]
  Metascore: string
  imdbRating: string
  imdbVotes: string
  imdbID: string
  Type: 'movie' | 'series' | 'episode'
  DVD?: string
  BoxOffice?: string
  Production?: string
  Website?: string
  totalSeasons?: string
}

// ============================================================================
// Internal Types
// ============================================================================

export interface RatingsData {
  rtCriticScore: number | null
  rtAudienceScore: number | null
  metacriticScore: number | null
  awardsSummary: string | null
  /** Spoken languages parsed from Language field (e.g., ["English", "French"]) */
  languages: string[] | null
  /** Production countries parsed from Country field (e.g., ["USA", "UK"]) */
  countries: string[] | null
  /**
   * IMDb's long synopsis, from `plot=full`.
   *
   * Several times the length of the one-paragraph overview the media server
   * syncs — and materially different in kind: it is user-submitted prose that
   * narrates the story rather than pitching it, so it names characters,
   * settings and turns the short blurb never reaches. That is why it is worth
   * embedding, and also why it must not be shown unprompted: for a film with a
   * twist it routinely gives it away.
   */
  plot: string | null
  /**
   * IMDb's rating and vote count, from the same response as everything else.
   *
   * The app already displays a 0–10 score, but it comes from
   * `movies.community_rating`, which the media server syncs — for Emby that
   * *is* the IMDb rating, so the number was right by inheritance and carried no
   * vote count and no source we control. Taking it here makes the provenance
   * explicit and is what supplies the count.
   */
  imdbRating: number | null
  imdbVotes: number | null
}

// ============================================================================
// Configuration
// ============================================================================

export const OMDB_API_BASE_URL = 'https://www.omdbapi.com'
