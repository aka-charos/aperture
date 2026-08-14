/**
 * OMDb Integration Module
 *
 * Provides access to OMDb API for:
 * - Rotten Tomatoes scores
 * - Metacritic scores
 * - Awards summaries
 */

// Client
export { omdbRequest } from './client.js'

// Failures — omdbRequest throws these; a null return means "OMDb has no entry"
// and nothing else, because callers record a null as asked-and-answered.
export {
  OmdbRequestError,
  classifyOmdbFailure,
  isGlobalOmdbFailure,
  isRetryableOmdbFailure,
  isNotFoundBody,
  type OmdbFailureKind,
} from './failures.js'

// Ratings functions
export {
  extractRatingsData,
  getRatingsData,
  getRatingsDataBatch,
  getOMDbData,
} from './ratings.js'

// Types
export type {
  OMDbRating,
  OMDbMovieResponse,
  RatingsData,
} from './types.js'

// Constants
export { OMDB_API_BASE_URL } from './types.js'


