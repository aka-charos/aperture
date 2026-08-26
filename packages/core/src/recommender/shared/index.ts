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
  buildSimilarityScale,
  normalizeSimilarity,
  calculateBaseScore,
  blendWeightShares,
  effectiveBlendWeights,
  noveltyGain,
  spreadOf,
  TARGET_COMPONENT_SPREAD,
  applyPreferenceAdjustment,
  summarizeScoreComponents,
  NOVELTY_SWEET_SPOT,
  NOVELTY_PEAK,
  NOVELTY_FAMILIAR_FLOOR,
  NOVELTY_ALIEN_FLOOR,
  type ScoringConfig,
  type BlendWeights,
  type BaseCandidate,
  type SimilarityScale,
  type PreferenceAffinities,
  type PreferenceDimensionWeights,
  DEFAULT_PREFERENCE_DIMENSION_WEIGHTS,
  DEFAULT_ERA_WEIGHT,
  type ComponentSummary,
  type ScoreComponentReport,
} from './scoring.js'

export {
  MMR_MIN_POOL,
  MMR_POOL_PER_SLOT,
  MIN_PENALTY_GAIN,
  MAX_PENALTY_GAIN,
  mmrPoolSize,
  pairwiseSimilarities,
  penaltyGain,
  selectWithMmr,
  shortlistIds,
  similarityFromEmbeddings,
  spreadOfValues,
  type MmrCandidate,
  type MmrResult,
} from './mmr.js'

export { averageEmbeddings } from './embeddings.js'

export { EVIDENCE_HISTORY_LIMIT } from './evidencePool.js'

export { allocateClusterCandidateLimits, MIN_CANDIDATES_PER_CLUSTER } from './clusterAllocation.js'

export {
  interestAffinityFromSimilarity,
  buildInterestMatchIndex,
  computeReservedInterestSlots,
  pickInterestSlotFillers,
  DEFAULT_INTEREST_MAX_SLOTS,
  MIN_INTEREST_SLOT_SIMILARITY,
  type InterestMatch,
  type InterestCandidateMatch,
  type InterestMatchIndex,
  type InterestQueryResult,
} from './interestSlots.js'

export {
  buildTwinIndex,
  deriveTwinThreshold,
  computeReservedTwinSlots,
  pickTwinSlotFillers,
  DEFAULT_TWIN_MAX_SLOTS,
  type TwinPair,
  type TwinDonor,
  type TwinIndex,
} from './twinSlots.js'


export {
  isAcclaimed,
  computeReservedAcclaimedSlots,
  pickAcclaimedSlotFillers,
  DEFAULT_ACCLAIMED_MAX_SLOTS,
  DEFAULT_ACCLAIMED_MIN_RATING,
  DEFAULT_ACCLAIMED_MIN_VOTES,
  type StoredAcclaimedPick,
} from './acclaimedSlots.js'
