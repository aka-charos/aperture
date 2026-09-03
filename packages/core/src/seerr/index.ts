/**
 * Seerr Integration Module
 * 
 * Provides API access to Seerr for content request management
 */

// Types
export * from './types.js'
export type { SeerrCallResult } from './provider.js'

// Provider functions
export {
  // Configuration
  getSeerrConfig,
  setSeerrConfig,
  isSeerrConfigured,
  testSeerrConnection,
  // Search & Media Info
  searchContent,
  getMovieDetails,
  getTVDetails,
  getMediaStatus,
  listAllSeerrUsers,
  resolveSeerrUserIdForProfile,
  seerrUserExists,
  // Request Management
  createRequest,
  updateRequestStatus,
  getRequest,
  getRequestStatus,
  deleteRequest,
  // Batch Operations
  batchGetMediaStatus,
  // Radarr / Sonarr (request options UI)
  listRadarrServers,
  getRadarrServerDetails,
  listSonarrServers,
  getSonarrServerDetails,
} from './provider.js'

export {
  matchApertureProfileToSeerrUser,
  resolveSeerrUserMatch,
  normalizeMediaServerId,
  type ApertureUserProfileForSeerr,
  type SeerrMatchTier,
  type SeerrUserMatchResult,
} from './userMapping.js'

