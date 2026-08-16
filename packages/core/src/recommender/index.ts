// Shared types and config
export * from './types.js'
export * from './config.js'
export * from './storage.js'

// Shared utilities (used by both movies and series)
export { averageEmbeddings } from './shared/embeddings.js'

// Movie recommendation exports
export {
  buildCanonicalText,
  embedMovies,
  storeEmbeddings,
  getMoviesNeedingEmbeddings,
  markEmbeddingsCurrent,
  CANONICAL_TEXT_VERSION,
  generateMissingEmbeddings,
  getMovieEmbedding,
} from './movies/embeddings.js'

export {
  generateRecommendationsForUser,
  generateRecommendationsForAllUsers,
  clearUserRecommendations,
  clearAllRecommendations,
  clearAndRebuildAllRecommendations,
  regenerateUserRecommendations,
} from './movies/pipeline.js'

// Explanations-only rerun, for both media types. Separate from the pipelines
// because it deliberately does not touch scoring or selection.
export {
  refreshExplanations,
  refreshAllExplanations,
  refreshExplanationsForRun,
  type ExplanationMediaType,
  type ExplanationRefreshOptions,
  type ExplanationRefreshResult,
} from './explanationRefresh.js'

export {
  syncMovies,
  syncWatchHistoryForUser,
  syncWatchHistoryForAllUsers,
} from './movies/sync.js'

// Series recommendation exports
export {
  buildSeriesCanonicalText,
  buildEpisodeCanonicalText,
  embedSeries,
  embedEpisodes,
  storeSeriesEmbeddings,
  storeEpisodeEmbeddings,
  getSeriesNeedingEmbeddings,
  markSeriesEmbeddingsCurrent,
  getEpisodesWithoutEmbeddings,
  generateMissingSeriesEmbeddings,
  getSeriesEmbedding,
  getEpisodeEmbedding,
  getSeriesEpisodeEmbeddings,
} from './series/embeddings.js'

export {
  generateSeriesRecommendationsForUser,
  generateSeriesRecommendationsForAllUsers,
  regenerateUserSeriesRecommendations,
  clearUserSeriesRecommendations,
  clearAllSeriesRecommendations,
  clearAndRebuildAllSeriesRecommendations,
  type SeriesUser,
  type SeriesCandidate,
  type SeriesPipelineConfig,
} from './series/pipeline.js'

export {
  syncSeries,
  syncSeriesWatchHistoryForUser,
  syncSeriesWatchHistoryForAllUsers,
} from './series/sync.js'
