/**
 * Types for the User Taste Profile system
 */

// Type-only: erased at compile time, so the centering.ts -> types.js edge
// (it imports MediaType) never becomes a runtime cycle.
import type { EmbeddingSpace } from '../recommender/centering.js'

export type MediaType = 'movie' | 'series'

export interface TasteProfile {
  id: string
  userId: string
  mediaType: MediaType
  embedding: number[] | null
  embeddingModel: string | null
  /**
   * Which embedding space `embedding` lives in (recommender/centering.ts).
   *
   * A profile is built once and read later, so without this the reader cannot
   * tell whether the centroid it holds is comparable to the column it is about
   * to query. Comparing across spaces is not "slightly worse" -- it is a cosine
   * between two different origins, which returns a confident ranking that means
   * nothing.
   *
   * Rows written before migration 0154 default to 'raw', which is what they are.
   */
  embeddingSpace: EmbeddingSpace
  autoUpdatedAt: Date | null
  userModifiedAt: Date | null
  isLocked: boolean
  refreshIntervalDays: number
  minFranchiseItems: number // Minimum items watched to include a franchise (1-10)
  minFranchiseSize: number // Minimum total items franchise must have in library (2-10)
  createdAt: Date
}

export interface FranchisePreference {
  id: string
  userId: string
  franchiseName: string
  mediaType: MediaType | 'both'
  preferenceScore: number // -1 to 1
  isUserSet: boolean
  itemsWatched: number
  totalEngagement: number // episodes/movies watched
  createdAt: Date
  updatedAt: Date
}

export interface GenreWeight {
  id: string
  userId: string
  genre: string
  weight: number // 0 = avoid, 1 = neutral, 2 = boost
  isUserSet: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CustomInterest {
  id: string
  userId: string
  interestText: string
  embedding: number[] | null
  embeddingModel: string | null
  weight: number
  createdAt: Date
}

export interface WatchedItem {
  id: string
  title: string
  episodeCount?: number // For series
  totalEpisodes?: number // For series
  completionRate?: number
  playCount: number
  hasFavorites: boolean
  lastPlayedAt: Date | null
  rating?: number // User rating if available
  genres: string[]
  franchiseName?: string
  collectionName?: string
}

export interface ProfileBuildOptions {
  forceRebuild?: boolean
  skipLockCheck?: boolean
  /**
   * Re-run franchise/genre auto-detection (in 'merge' mode, so user-set
   * preferences are never overwritten) whenever the embedding rebuilds.
   * Defaults to true. Callers that manage detection themselves with a
   * custom mode/thresholds (the manual "rebuild profile" settings action)
   * should pass false to avoid running it twice.
   */
  refreshPreferences?: boolean
}

export interface UserTasteData {
  profile: TasteProfile | null
  franchises: FranchisePreference[]
  genres: GenreWeight[]
  customInterests: CustomInterest[]
}

export interface ProfileUpdateResult {
  success: boolean
  profile: TasteProfile | null
  franchisesUpdated: number
  genresUpdated: number
  error?: string
}

// Refresh interval options for the UI dropdown
export const REFRESH_INTERVAL_OPTIONS = [7, 14, 30, 60, 90, 180, 365] as const
export type RefreshIntervalDays = (typeof REFRESH_INTERVAL_OPTIONS)[number]

export const DEFAULT_REFRESH_INTERVAL_DAYS = 30

// Minimum franchise watched items options for the UI dropdown (1-10)
export const MIN_FRANCHISE_ITEMS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export type MinFranchiseItems = (typeof MIN_FRANCHISE_ITEMS_OPTIONS)[number]
export const DEFAULT_MIN_FRANCHISE_ITEMS = 1

// Minimum franchise size (total in library) options for the UI dropdown (2-10)
export const MIN_FRANCHISE_SIZE_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export type MinFranchiseSize = (typeof MIN_FRANCHISE_SIZE_OPTIONS)[number]
export const DEFAULT_MIN_FRANCHISE_SIZE = 2

