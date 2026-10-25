// Unified types for both Movies and Series

import type { ConnectionReason } from '../../components/SimilarityGraph/types'
import type { StudioLogoData } from '../../components/StudioLogo'

export type MediaType = 'movie' | 'series'

export type StudioItem = string | { id?: string; name: string }

export interface StreamingProvider {
  id: number
  name: string
}

export interface Actor {
  name: string
  role?: string
  thumb?: string
}

// Base media interface with shared properties
/** Mirrors core's UnifiedRatingSource by hand (the bundle never imports core). */
export type QualityRatingSource = 'imdb' | 'mediaServer' | 'tmdb' | 'metacritic' | 'rt'

export interface BaseMedia {
  id: string
  provider_item_id: string
  title: string
  original_title: string | null
  year: number | null
  genres: string[]
  overview: string | null
  community_rating: number | null
  poster_url: string | null
  backdrop_url: string | null
  // Crew
  directors?: string[]
  writers?: string[]
  // TMDb enrichment
  keywords?: string[]
  // OMDb enrichment
  rt_critic_score?: number | null
  rt_audience_score?: number | null
  rt_consensus?: string | null
  metacritic_score?: number | null
  awards_summary?: string | null
  plot_full?: string | null
  /**
   * Machine translation of the synopsis into the language the page is shown
   * in, decided by the server; absent or null when there is none. Either field
   * may be null on its own — then that text shows in the original.
   */
  localized_synopsis?: {
    language: string
    source_language: string
    overview: string | null
    plot_full: string | null
  } | null
  tmdb_rating?: number | null
  tmdb_vote_count?: number | null
  imdb_rating?: number | null
  imdb_vote_count?: number | null
  /**
   * The unified quality rating (0-10) recommendations score on, decided by the
   * server (core ratings/unifiedRating.ts); null when no source rates the
   * title. Absent from an older API, which the headline reads as "use
   * community_rating" (qualityRating.ts).
   */
  quality_rating?: number | null
  /** What quality_rating is made of, decided by the server. Mirrors core's UnifiedRatingSource. */
  quality_rating_sources?: QualityRatingSource[]
  languages?: string[] | null
  production_countries?: string[] | null
  // MDBList enrichment
  letterboxd_score?: number | null
  mdblist_score?: number | null
  streaming_providers?: StreamingProvider[] | null
  /**
   * Logos for this title's studios, keyed by studio name, decided by the
   * server (media server first, TMDb otherwise); a studio with none is absent.
   */
  studio_logos?: Record<string, StudioLogoData>
}

// Movie-specific properties
export interface Movie extends BaseMedia {
  type: 'movie'
  runtime_minutes: number | null
  cinematographers?: string[]
  composers?: string[]
  editors?: string[]
  collection_id?: string | null
  collection_name?: string | null
  actors?: Actor[]
  studios?: StudioItem[]
  imdb_id?: string | null
  tmdb_id?: string | null
}

// Series-specific properties
export interface Series extends BaseMedia {
  type: 'series'
  end_year: number | null
  tagline: string | null
  critic_rating: number | null
  content_rating: string | null
  status: string | null
  total_seasons: number | null
  total_episodes: number | null
  /** Average episode length from library metadata, when episodes have runtimes */
  average_episode_runtime_minutes: number | null
  network: string | null
  /** The network's logo, decided by the server; absent or null when none. */
  network_logo?: StudioLogoData | null
  studios: StudioItem[]
  actors: Actor[]
  imdb_id: string | null
  tmdb_id: string | null
  tvdb_id: string | null
  air_days: string[]
  awards: string | null
  // TMDB season data (cached server-side; null until first fetch)
  tmdb_total_episodes?: number | null
  tmdb_total_seasons?: number | null
  tmdb_seasons?: Array<{
    season_number: number
    episode_count: number
    air_date: string | null
  }> | null
  tmdb_status?: string | null
}

// Union type for any media item
export type Media = Movie | Series

// Type guards
export function isMovie(media: Media): media is Movie {
  return media.type === 'movie'
}

export function isSeries(media: Media): media is Series {
  return media.type === 'series'
}

export interface Episode {
  id: string
  season_number: number
  episode_number: number
  title: string
  overview: string | null
  premiere_date: string | null
  runtime_minutes: number | null
  community_rating: number | null
  poster_url: string | null
  // Current-user watch state (present on series episodes; optional for forward/back compat)
  played?: boolean
  play_count?: number
  last_played_at?: string | null
  /** Resume position as a whole percent (0-100), or null when never started */
  progress_percent?: number | null
}

/**
 * Per-season view of what has aired (per TMDB) vs what the media server holds.
 * Computed server-side so the detail page, the watching page, and the request
 * flow all agree on what "missing" means.
 */
export interface SeasonAvailability {
  season_number: number
  episodes_on_server: number
  /** null for specials / seasons TMDB has no data for */
  tmdb_episode_count: number | null
  /** Aired episodes, capped at (next episode - 1) for the season currently airing */
  aired_episodes: number | null
  /** aired_episodes - episodes_on_server, floored at 0; always 0 when unknown */
  missing_episodes: number
  has_aired: boolean
}

export interface WatchStatus {
  isWatched: boolean
  playCount: number
  lastWatched: string | null
}

export interface SimilarItem {
  id: string
  title: string
  year: number | null
  poster_url: string | null
  genres?: string[]
  network?: string | null
  similarity: number
  reasons?: ConnectionReason[]
}

export interface RecommendationInsights {
  isRecommended: boolean
  isSelected?: boolean
  /** Position among everything the run scored, not among the picks. */
  rank?: number
  /** How many titles that run scored — the denominator for `rank`. */
  totalCandidates?: number
  message?: string
  /**
   * The generated "why this was picked" paragraph. Null whenever the admin (or
   * the user) has AI explanations switched off, and also for any run generated
   * while it was off, since generation is gated on the same setting.
   */
  aiExplanation?: string | null
  scores?: {
    /** The match percentage. Blend of the three components below, then nudged by preferences. */
    final: number
    /**
     * Raw cosine to the taste centroid. Comparable with the evidence
     * percentages — both are item-to-item distances — and NOT comparable with
     * novelty, rating or `final`, which is why it is no longer what the score
     * panel draws.
     */
    similarity: number | null
    /**
     * `similarity` rescaled against the run's own candidate pool: the value the
     * blend actually consumed. Null on runs generated before migration 0141,
     * which is the signal that the arithmetic cannot be shown for this row.
     */
    normalizedSimilarity: number | null
    novelty: number | null
    rating: number | null
    /**
     * How much variety this pick added to the list. Used to order the list, and
     * deliberately NOT part of `final` — see the panel.
     */
    diversity: number | null
    /** The blend before preference affinities moved it. Null on pre-0141 runs. */
    base: number | null
  }
  /**
   * The range each score component can actually occupy, from core's own
   * constants. Novelty's curve floors well above zero, so a bar drawn on 0-100
   * would sit half full at the component's minimum.
   */
  scoreScales?: {
    novelty: { min: number; max: number }
  }
  /**
   * The share of the match each component carried, summing to 1, as the run
   * itself blended them. Null for runs predating migration 0147 — and null
   * rather than a default, because the weights are per user and an admin can
   * move them, so there is no safe number to assume.
   */
  scoreWeights?: {
    similarity: number
    novelty: number
    rating: number
  } | null
  scoreBreakdown?: Record<string, unknown>
  /**
   * For a taste-twin pick: titles the reader and their twin both PLAYED,
   * nearest to the pick first. The twin is why the pick is here; these are
   * what it resembles in the history the two share, merged into the evidence
   * row (closestRow.ts) and marked as the twin's.
   *
   * `similarity` is the same raw cosine an evidence row carries, null when
   * the title has no vector. Empty for every other pick, and for twin picks
   * from runs that stored the rarest shared titles instead (unrelated to the
   * pick, so the server sends none).
   */
  twinShared?: Array<{
    id: string
    title: string
    year: number | null
    poster_url: string | null
    similarity: number | null
  }>
  /**
   * Who the taste twin is — present ONLY when they are one of the reader's
   * visible connections, decided server-side. Absent for everyone else, and
   * absent is the anonymous line: the response carries no id to resolve.
   */
  twinDonor?: {
    name: string
    avatarUrl: string
  }
  /**
   * Decided server-side: a twin pick that came close to the list on its own
   * score (inside its range, or just outside). The banner then says so instead
   * of crediting the twin "rather than the scores below". Absent on any other
   * pick and on runs that stored no standing, which keep the old copy.
   */
  twinCameClose?: boolean
  /**
   * Whether `evidence` below is close enough to be called the reason for the
   * pick, decided server-side by hasCausalEvidence against a raw-cosine floor.
   *
   * The lookup that fills `evidence` keeps the three nearest titles in this
   * viewer's watch history WITH NO DISTANCE FLOOR, so it always returns three
   * and "the best available" is indistinguishable from "a good match" once
   * rendered. Measured live, a viewer was shown Das Boot at 0.67 under a
   * heading reading "based on your history with similar movies".
   *
   * ABSENT means the run predates this field, and absent must read as
   * PERMITTED rather than denied: old runs keep the heading they shipped with,
   * exactly as the preference chain and the weight shares do.
   */
  evidenceSupportsCause?: boolean
  evidence?: Array<{
    id: string
    similar_movie_id?: string
    similar_series_id?: string
    similarity: number
    evidence_type: string
    similar_movie?: {
      id: string
      title: string
      year: number | null
      poster_url: string | null
      genres: string[]
    }
    similar_series?: {
      id: string
      title: string
      year: number | null
      poster_url: string | null
      genres: string[]
    }
  }>
  genreAnalysis?: {
    movieGenres?: string[]
    mediaGenres?: string[]
    matchingGenres: string[]
    newGenres: string[]
    userTopGenres: Array<{ genre: string; weight: number }>
  }
}

export interface MediaServerInfo {
  baseUrl: string
  type: string
  serverId: string
  serverName: string
  displayName?: string
  webClientUrl: string
}

// Watch statistics
/**
 * One named watcher. Present only when the server decided this viewer may see
 * names — today that means an admin — and ABSENT otherwise, never an empty
 * array, so the payload is the privacy boundary rather than a UI condition.
 */
/** Whose names a watch counter carries. See MovieWatchStats.watcherAudience. */
export type WatcherAudience = 'all' | 'connections'

export interface Watcher {
  userId: string
  name: string
  playCount: number
  /** Episodes of this series played. Absent for a movie. */
  episodesWatched?: number
  lastWatched: string | null
  favorite: boolean
}

export interface MovieWatchStats {
  totalWatchers: number
  totalPlays: number
  favoritesCount: number
  firstWatched: string | null
  lastWatched: string | null
  averageUserRating: number | null
  totalRatings: number
  watchPercentage: number
  totalUsers: number
  watchers?: Watcher[]
  /**
   * Who the names in `watchers` were chosen for, decided by the server: `all`
   * (an admin sees everyone) or `connections` (the viewer and the people they
   * are connected to — a partial list). Absent means the pre-connections copy.
   */
  watcherAudience?: WatcherAudience
}

export interface SeriesWatchStats {
  currentlyWatching: number
  totalViewers: number
  completedViewers: number
  totalEpisodes: number
  totalEpisodePlays: number
  favoritedEpisodes: number
  firstWatched: string | null
  lastWatched: string | null
  averageUserRating: number | null
  totalRatings: number
  averageProgress: number
  watchPercentage: number
  totalUsers: number
  watchers?: Watcher[]
  /**
   * Who the names in `watchers` were chosen for, decided by the server: `all`
   * (an admin sees everyone) or `connections` (the viewer and the people they
   * are connected to — a partial list). Absent means the pre-connections copy.
   */
  watcherAudience?: WatcherAudience
}

