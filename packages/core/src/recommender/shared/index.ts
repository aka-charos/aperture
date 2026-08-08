/**
 * Shared Recommendation Algorithm Components
 *
 * This module provides unified scoring and selection algorithms
 * that are used by both movie and series recommendation pipelines.
 */

export {
  calculateRatingScore,
  buildGenreFamiliarity,
  calculateGenreNoveltyScore,
  calculateBaseScore,
  applyPreferenceAdjustment,
  summarizeScoreComponents,
  NOVELTY_SWEET_SPOT,
  NOVELTY_PEAK,
  NOVELTY_FAMILIAR_FLOOR,
  NOVELTY_ALIEN_FLOOR,
  type ScoringConfig,
  type BaseCandidate,
  type PreferenceAffinities,
  type ComponentSummary,
  type ScoreComponentReport,
} from './scoring.js'

export {
  calculateDiversityBoost,
  applyDiversitySelection,
  applySimpleSelection,
  type SelectableCandidate,
  type SelectionResult,
} from './selection.js'

export { averageEmbeddings } from './embeddings.js'

export { allocateClusterCandidateLimits, MIN_CANDIDATES_PER_CLUSTER } from './clusterAllocation.js'

export {
  interestAffinityFromSimilarity,
  buildInterestMatchIndex,
  computeReservedInterestSlots,
  pickInterestSlotFillers,
  MAX_INTEREST_SLOTS,
  INTEREST_SLOT_SHARE,
  MIN_INTEREST_SLOT_SIMILARITY,
  type InterestMatch,
  type InterestCandidateMatch,
  type InterestMatchIndex,
  type InterestQueryResult,
} from './interestSlots.js'

