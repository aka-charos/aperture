export interface LibraryConfig {
  id: string
  providerLibraryId: string
  name: string
  collectionType: string
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface MediaTypeConfig {
  maxCandidates: number
  selectedCount: number
  /** MAD multiplier deciding who counts as a taste twin (1-4). */
  twinThresholdK: number
  /** Ceiling on picks borrowed from a taste twin; 0 disables the feature. */
  twinMaxSlots: number
  /** Ceiling on picks reserved for stated interests; shares the selectedCount budget. */
  interestMaxSlots: number
  /**
   * Ceiling on picks reserved for widely-acclaimed titles; 0 disables, and is
   * the default. Third claimant on the same selectedCount budget.
   */
  acclaimedMaxSlots: number
  /** Rating a title must reach to be eligible for an acclaimed slot. */
  acclaimedMinRating: number
  /**
   * Votes that rating must be built on. An eligibility gate only — vote count
   * never enters any title’s score.
   */
  acclaimedMinVotes: number
  /**
   * Share of a candidate’s remaining gap to 1.0 that a maxed franchise/genre/
   * interest signal may close. 0 disables the nudge.
   */
  preferenceStrength: number
  recentWatchLimit: number
  similarityWeight: number
  noveltyWeight: number
  ratingWeight: number
  diversityWeight: number
  /** Activity gate: new titles required before the catalogue counts as changed */
  newCandidateThreshold: number
  /** Activity gate: regenerate regardless once the last run is this old */
  maxRunAgeDays: number
}

export interface RecommendationConfig {
  movie: MediaTypeConfig
  series: MediaTypeConfig
  updatedAt: string
  scoringUpdatedAt: string
}

export interface PurgeStats {
  // Content
  movies: number
  series: number
  episodes: number
  // AI Embeddings
  movieEmbeddings: number
  seriesEmbeddings: number
  episodeEmbeddings: number
  // User Data
  watchHistory: number
  userRatings: number
  recommendations: number
  userPreferences: number
  // Assistant
  assistantConversations: number
  assistantMessages: number
}

export interface UserSettings {
  userId: string
  libraryName: string | null
  createdAt: string
  updatedAt: string
}

export interface EmbeddingModelInfo {
  id: string
  name: string
  description: string
  dimensions: number
  costPer1M: string
}

export interface EmbeddingModelConfig {
  currentModel: string
  availableModels: EmbeddingModelInfo[]
  movieCount: number
  embeddingsByModel: Record<string, number>
}

export const MAX_UNLIMITED = 999999999

