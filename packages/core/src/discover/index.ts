/**
 * Discovery Module
 * 
 * Suggests content not in the user's library based on AI recommendations
 * and external integrations (TMDb, Trakt, MDBList)
 */

// Types
export * from './types.js'

// Pipeline
export {
  generateDiscoveryForUser,
  generateDiscoveryForAllUsers,
  regenerateUserDiscovery,
  getDiscoveryEnabledUsers,
} from './pipeline.js'

// Sources
export {
  fetchFilteredCandidates,
  fetchGenreStripDiscoverCandidates,
  enrichFullData,
  enrichBasicData,
  hasDiscoverySources,
  // Two-phase fetching (shared pool architecture)
  fetchGlobalCandidates,
  fetchPersonalizedCandidates,
  mergeWithPool,
  type DynamicFetchFilters,
  type GenreStripDiscoverFilters,
} from './sources.js'

// Filter
export {
  filterCandidates,
  getCandidateExclusionTmdbIds,
} from './filter.js'

// Candidate embeddings (the taste term's vectors)
export {
  getCandidateEmbeddings,
  buildCandidateCanonicalText,
  getLibraryEmbeddingMean,
  centreVector,
  clearOrphanedCandidateEmbeddings,
} from './embeddings.js'

// Configuration (admin-tunable pipeline knobs)
export {
  getDiscoveryConfig,
  setDiscoveryConfig,
  sanitizeDiscoveryConfig,
  DISCOVERY_CONFIG_BOUNDS,
} from './config.js'

// Reconciliation (Seerr request status sweep)
export {
  reconcileDiscoveryRequests,
  resolveRequestStatus,
  type ReconcileResult,
} from './reconcile.js'

// Scorer
export {
  scoreCandidates,
  popularityScoresBySource,
  tasteSimilarityRanks,
  SOURCE_TERM_WEIGHT,
} from './scorer.js'

// Genre strip ordering (rows by taste; titles deliberately untouched)
export {
  orderGenreStripRowsByTaste,
  genreStripRowAffinity,
} from './genreStripOrder.js'

// Blend diagnostics (what the weights claim vs what they do)
export {
  getDiscoveryBlendDiagnostics,
  configuredBlendShares,
  realisedBlendShares,
  type BlendDiagnostics,
  type BlendTerms,
  type TermSpreads,
} from './blendDiagnostics.js'

// Storage
export {
  createDiscoveryRun,
  updateDiscoveryRunStats,
  finalizeDiscoveryRun,
  getLatestDiscoveryRun,
  storeDiscoveryCandidates,
  getDiscoveryCandidates,
  getDiscoveryCandidateCount,
  clearDiscoveryCandidates,
  createDiscoveryRequest,
  updateDiscoveryRequestStatus,
  getDiscoveryRequests,
  countDiscoveryRequests,
  hasExistingRequest,
  // Pool storage (shared candidates)
  upsertPoolCandidates,
  getPoolCandidates,
  clearOldPoolEntries,
  poolCandidateToRaw,
} from './storage.js'

// Browse: distinct people in library (actors + directors)
export {
  listPeopleForBrowse,
  type PersonBrowseRow,
  type ListPeopleBrowseOptions,
  type ListPeopleBrowseResult,
} from './peopleBrowse.js'

// TMDb credits vs library gap
export {
  getPersonCreditsGap,
  flattenCombinedCredits,
  flattenCombinedCreditsWithRoles,
  creditsRoleKindFromEntry,
  formatCreditsGapGroupLabel,
  type PersonCreditsGapOptions,
  type PersonCreditsGapRow,
  type PersonCreditsGapResult,
  type PersonCreditsGapGroup,
  type CreditsRoleKind,
} from './personCreditsGap.js'

// Person portrait push (media server item id from sync)
export { findPersonMediaServerItemIdForName } from './personPortraitPush.js'

// Media server person metadata (bio, birth/death, birthplace) with DB cache
export {
  getPersonMediaServerDetails,
  type PersonMediaServerDetails,
} from './personMediaServerDetails.js'

