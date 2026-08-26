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
  /**
   * Votes behind communityRating. Read ONLY by the acclaimed-slot gate
   * (shared/acclaimedSlots.ts) -- never by scoring, where it would promote
   * obscure poorly-rated titles.
   */
  voteCount: number | null
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
  /** Ceiling on picks reserved for widely-acclaimed titles; 0 disables (default). */
  acclaimedMaxSlots: number
  /** Rating an acclaimed pick must reach. */
  acclaimedMinRating: number
  /** Votes that rating must be built on. A gate, never a score term. */
  acclaimedMinVotes: number
  /**
   * Share of the remaining gap to 1.0 a maxed preference signal may close.
   * 0 switches the nudge off.
   */
  preferenceStrength: number
  /**
   * Relative strength of the decade-preference dimension inside that nudge.
   * 0 disables it and restores the exact pre-era behaviour of the other three.
   * See recommender/eraAffinity.ts.
   */
  eraWeight: number
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
  acclaimedMaxSlots: 0,
  acclaimedMinRating: 8.3,
  acclaimedMinVotes: 50000,
  preferenceStrength: 0.5,
  // Literal rather than imported: this module is types only and pulling in
  // scoring.ts for one constant would make a type file a runtime dependency.
  // scoring.ts's DEFAULT_ERA_WEIGHT is the value that governs; this is the
  // fallback for a config read that threw, and both are the feature's off state.
  eraWeight: 0,
}

