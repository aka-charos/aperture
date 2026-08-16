export interface User {
  id: string
  username: string
  providerUserId: string
  maxParentalRating?: number | null
  moviesEnabled?: boolean
  seriesEnabled?: boolean
}

export interface WatchedMovie {
  movieId: string
  lastPlayedAt: Date | null
  playCount: number
  isFavorite: boolean
}

export interface Candidate {
  movieId: string
  id: string // Alias for movieId - used by shared selection algorithm
  title: string
  year: number | null
  genres: string[]
  communityRating: number | null
  /** Raw cosine to the taste vector. See BaseCandidate. */
  similarity: number
  /** Pool-relative similarity, which is what the score blend reads. See BaseCandidate. */
  normalizedSimilarity: number
  novelty: number
  ratingScore: number
  diversityScore: number
  diversityBoost: number // Used by shared selection algorithm
  /** Quality match, comparable across every candidate in a run. See BaseCandidate. */
  finalScore: number
  /** The blend before preference affinities moved it. See BaseCandidate. */
  baseScore?: number
  /** Diversity-blended ranking score, selected candidates only. See BaseCandidate. */
  selectionScore?: number
}

export interface PipelineConfig {
  maxCandidates: number
  selectedCount: number
  similarityWeight: number
  noveltyWeight: number
  ratingWeight: number
  diversityWeight: number
  recentWatchLimit: number
  /** MAD multiplier deciding who counts as a taste twin. See twinAffinity.ts. */
  twinThresholdK: number
  /** Ceiling on picks borrowed from a taste twin; 0 disables. */
  twinMaxSlots: number
  /** Ceiling on picks reserved for stated interests; 0 disables. */
  interestMaxSlots: number
}

// Fallback defaults (used only if DB fetch fails)
// selectedCount is the admin's `recommendation_config.{movie,series}_selected_count`
// in every normal run; this value applies only when that read throws.
export const FALLBACK_CONFIG: PipelineConfig = {
  maxCandidates: 50000,
  selectedCount: 20,
  similarityWeight: 0.4,
  noveltyWeight: 0.2,
  ratingWeight: 0.2,
  diversityWeight: 0.2,
  recentWatchLimit: 50,
  twinThresholdK: 2.0,
  twinMaxSlots: 4,
  interestMaxSlots: 3,
}

