/**
 * Offline evaluation for the retrieval half of the recommender.
 *
 * Two instruments, on purpose:
 *
 *   `neighbours.ts` — what a title's nearest neighbours actually are, printed
 *   for a person to read. PRIMARY. Someone who knows twenty films can judge a
 *   retrieval change from this in a minute, and will trust the answer.
 *
 *   `metrics.ts` — NDCG over a graded holdout. A GUARD RAIL, never a target.
 *   Every label available here is imperfect (watched means "got 5% in",
 *   favourited means "bookmarked" as often as "loved"), so relevance is graded
 *   by how much each signal is believed rather than asserted as a yes/no.
 *
 * Tuning anything to maximise the metric produces a recommender that serves
 * more of whatever you last regretted watching. Read the header of `metrics.ts`.
 */

export {
  ABANDONED_THRESHOLD,
  COMPLETION_THRESHOLD,
  DEFAULT_RELEVANCE_WEIGHTS,
  MIN_TEST_ITEMS,
  SKEPTICAL_RELEVANCE_WEIGHTS,
  gradeRelevance,
  qualifies,
  splitHoldout,
  type GradedItem,
  type HoldoutSplit,
  type RelevanceWeights,
  type WatchRecord,
} from './holdout.js'

export {
  DEFAULT_CUTOFFS,
  HISTORY_BUCKETS,
  dcg,
  historyBucket,
  macroAverage,
  median,
  ndcgAt,
  percentileRank,
  scoreUser,
  weightedRecallAt,
  type AggregateMetrics,
  type RankedHit,
  type UserMetrics,
} from './metrics.js'

export {
  libraryMean,
  loadLibraryMatrix,
  meanCenter,
  prepareQuery,
  rowAsQuery,
  scoreAll,
  weightedCentroid,
  type LibraryMatrix,
} from './embeddingMatrix.js'

export {
  buildNeighbourReports,
  countryConcentration,
  fetchTitleFacts,
  formatNeighbourReport,
  nearestTo,
  popularSeedIds,
  resolveSeedIds,
  type NeighbourReport,
  type NeighbourRow,
  type TitleFacts,
} from './neighbours.js'

export {
  DEFAULT_HOLDOUT_SIZE,
  DEFAULT_NEIGHBOUR_TOP_N,
  DEFAULT_SEED_COUNT,
  DEFAULT_VARIANTS,
  runEvaluation,
  type EvaluationOptions,
  type EvaluationReport,
  type EvaluationVariant,
  type VariantResult,
} from './run.js'
