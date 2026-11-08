/**
 * Seerr Integration Module
 * 
 * Provides API access to Seerr for content request management
 */

// Types
export * from './types.js'
export type { SeerrCallResult, SeerrActAs } from './provider.js'

// Sending requests, and settling one whose answer was lost
export {
  withSeerrRequestLock,
  isSeerrRequestInFlight,
  settleUnconfirmedRequestsFor,
  settleUnconfirmedBatch,
  listUnconfirmedRequests,
  recordSeerrAnswer,
  settleListedRequests,
  UNCONFIRMED_REQUEST_MESSAGE,
  type SeerrSubmission,
} from './submission.js'
export {
  SEERR_CREATE_TIMEOUT_MS,
  UNCONFIRMED_GIVE_UP_MS,
  isUncertainCreateFailure,
  findSubmittedRequest,
  decideUnconfirmed,
  decideTitleRows,
  type SeerrRequestTrace,
  type UnconfirmedOutcome,
} from './submissionRules.js'

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
  getTitleRequests,
  listAllSeerrUsers,
  resolveSeerrUserIdForProfile,
  seerrUserExists,
  // Request Management
  createRequest,
  updateRequestStatus,
  // Issues
  createIssue,
  listIssues,
  getIssue,
  createIssueComment,
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

