import { query, queryOne } from './db.js'
import { createChildLogger } from './logger.js'

const logger = createChildLogger('recommendation-config')

export interface MediaTypeConfig {
  maxCandidates: number
  selectedCount: number
  recentWatchLimit: number
  similarityWeight: number
  noveltyWeight: number
  ratingWeight: number
  diversityWeight: number
  /**
   * Newly-available titles required before the catalogue counts as changed.
   * Read by the activity gate; does not affect what gets recommended.
   */
  newCandidateThreshold: number
  /**
   * Regenerate regardless once the last completed run is this old. The backstop
   * for inputs the activity gate does not enumerate.
   */
  maxRunAgeDays: number
  /**
   * How far above the typical pair a viewer's rarity-weighted overlap must sit
   * before their picks are borrowed, in multiples of the median absolute
   * deviation. Higher is stricter. See recommender/twinAffinity.ts.
   */
  twinThresholdK: number
  /**
   * Ceiling on picks drawn from a taste twin. 0 disables the feature; the
   * realised count also scales with selectedCount (shared/twinSlots.ts).
   */
  twinMaxSlots: number
}

export interface RecommendationConfig {
  movie: MediaTypeConfig
  series: MediaTypeConfig
  updatedAt: Date
  /**
   * Last change to a setting that affects what gets recommended. Distinct from
   * updatedAt, which an updated_at trigger moves on any write — including the
   * activity gate's own thresholds, which must not force a regeneration.
   */
  scoringUpdatedAt: Date
}

// Legacy interface for backward compatibility
export interface LegacyRecommendationConfig extends MediaTypeConfig {
  updatedAt: Date
}

interface RecommendationConfigRow {
  movie_max_candidates: number
  movie_selected_count: number
  movie_recent_watch_limit: number
  movie_similarity_weight: string
  movie_novelty_weight: string
  movie_rating_weight: string
  movie_diversity_weight: string
  movie_new_candidate_threshold: number
  movie_max_run_age_days: number
  movie_twin_threshold_k: string
  movie_twin_max_slots: number
  series_max_candidates: number
  series_selected_count: number
  series_recent_watch_limit: number
  series_similarity_weight: string
  series_novelty_weight: string
  series_rating_weight: string
  series_diversity_weight: string
  series_new_candidate_threshold: number
  series_max_run_age_days: number
  series_twin_threshold_k: string
  series_twin_max_slots: number
  updated_at: Date
  scoring_updated_at: Date
}

// Default values
const MOVIE_DEFAULTS: MediaTypeConfig = {
  maxCandidates: 50000,
  selectedCount: 20,
  recentWatchLimit: 50,
  similarityWeight: 0.4,
  noveltyWeight: 0.2,
  ratingWeight: 0.2,
  diversityWeight: 0.2,
  newCandidateThreshold: 12,
  maxRunAgeDays: 35,
  twinThresholdK: 2.0,
  twinMaxSlots: 4,
}

const SERIES_DEFAULTS: MediaTypeConfig = {
  maxCandidates: 50000,
  selectedCount: 20,
  recentWatchLimit: 100,
  similarityWeight: 0.4,
  noveltyWeight: 0.2,
  ratingWeight: 0.2,
  diversityWeight: 0.2,
  // Lower than movies on purpose: shows arrive far less often, so waiting for
  // the same batch would mean the catalogue signal never fires for series.
  newCandidateThreshold: 6,
  maxRunAgeDays: 35,
  twinThresholdK: 2.0,
  twinMaxSlots: 4,
}

/**
 * Column suffix for each field, shared by the readers and the writers so a new
 * setting cannot be half-wired.
 */
const COLUMN_SUFFIX: Record<keyof MediaTypeConfig, string> = {
  maxCandidates: 'max_candidates',
  selectedCount: 'selected_count',
  recentWatchLimit: 'recent_watch_limit',
  similarityWeight: 'similarity_weight',
  noveltyWeight: 'novelty_weight',
  ratingWeight: 'rating_weight',
  diversityWeight: 'diversity_weight',
  newCandidateThreshold: 'new_candidate_threshold',
  maxRunAgeDays: 'max_run_age_days',
  twinThresholdK: 'twin_threshold_k',
  twinMaxSlots: 'twin_max_slots',
}

/**
 * The settings that change *what* gets recommended, as opposed to *when* we
 * recompute it. Only these bump scoring_updated_at — see the column comment in
 * migration 0131.
 */
const SCORING_FIELDS = new Set<keyof MediaTypeConfig>([
  'maxCandidates',
  'selectedCount',
  'recentWatchLimit',
  'similarityWeight',
  'noveltyWeight',
  'ratingWeight',
  'diversityWeight',
  // Both decide which titles reach the final list, so an edit has to invalidate
  // the gate. Left out, lowering the twin threshold would appear to do nothing
  // until max_run_age_days eventually forced a run.
  'twinThresholdK',
  'twinMaxSlots',
])

/**
 * Get the full recommendation configuration (movies and series)
 */
export async function getRecommendationConfig(): Promise<RecommendationConfig> {
  const row = await queryOne<RecommendationConfigRow>(
    `SELECT
      movie_max_candidates, movie_selected_count, movie_recent_watch_limit,
      movie_similarity_weight, movie_novelty_weight, movie_rating_weight, movie_diversity_weight,
      movie_new_candidate_threshold, movie_max_run_age_days,
      movie_twin_threshold_k, movie_twin_max_slots,
      series_max_candidates, series_selected_count, series_recent_watch_limit,
      series_similarity_weight, series_novelty_weight, series_rating_weight, series_diversity_weight,
      series_new_candidate_threshold, series_max_run_age_days,
      series_twin_threshold_k, series_twin_max_slots,
      updated_at, scoring_updated_at
     FROM recommendation_config WHERE id = 1`
  )

  if (!row) {
    logger.warn('No recommendation config found, using defaults')
    return {
      movie: MOVIE_DEFAULTS,
      series: SERIES_DEFAULTS,
      updatedAt: new Date(),
      scoringUpdatedAt: new Date(),
    }
  }

  return {
    movie: {
      maxCandidates: row.movie_max_candidates,
      selectedCount: row.movie_selected_count,
      recentWatchLimit: row.movie_recent_watch_limit,
      similarityWeight: parseFloat(row.movie_similarity_weight),
      noveltyWeight: parseFloat(row.movie_novelty_weight),
      ratingWeight: parseFloat(row.movie_rating_weight),
      diversityWeight: parseFloat(row.movie_diversity_weight),
      newCandidateThreshold: row.movie_new_candidate_threshold,
      maxRunAgeDays: row.movie_max_run_age_days,
      twinThresholdK: parseFloat(row.movie_twin_threshold_k),
      twinMaxSlots: row.movie_twin_max_slots,
    },
    series: {
      maxCandidates: row.series_max_candidates,
      selectedCount: row.series_selected_count,
      recentWatchLimit: row.series_recent_watch_limit,
      similarityWeight: parseFloat(row.series_similarity_weight),
      noveltyWeight: parseFloat(row.series_novelty_weight),
      ratingWeight: parseFloat(row.series_rating_weight),
      diversityWeight: parseFloat(row.series_diversity_weight),
      newCandidateThreshold: row.series_new_candidate_threshold,
      maxRunAgeDays: row.series_max_run_age_days,
      twinThresholdK: parseFloat(row.series_twin_threshold_k),
      twinMaxSlots: row.series_twin_max_slots,
    },
    updatedAt: row.updated_at,
    scoringUpdatedAt: row.scoring_updated_at,
  }
}

/**
 * Get movie-only configuration (for backward compatibility)
 */
export async function getMovieRecommendationConfig(): Promise<LegacyRecommendationConfig> {
  const config = await getRecommendationConfig()
  return {
    ...config.movie,
    updatedAt: config.updatedAt,
  }
}

/**
 * Get series-only configuration
 */
export async function getSeriesRecommendationConfig(): Promise<LegacyRecommendationConfig> {
  const config = await getRecommendationConfig()
  return {
    ...config.series,
    updatedAt: config.updatedAt,
  }
}

/**
 * Apply a partial update to one media type's half of the single config row.
 *
 * Shared by both media types because the two column sets differ only by prefix,
 * and because the scoring_updated_at rule below has to hold for both: an admin
 * lowering the gate's own thresholds must not thereby trigger the full
 * regeneration the gate exists to prevent.
 */
async function updateConfigFor(
  prefix: 'movie' | 'series',
  updates: Partial<MediaTypeConfig>
): Promise<RecommendationConfig> {
  // Compared by value, not by presence: the settings page PATCHes the whole
  // media-type object on every save, so "a scoring field was supplied" would be
  // true even when the admin only moved a gate threshold — and that would
  // regenerate everyone, which is the thing the gate exists to avoid.
  const current = await getRecommendationConfig()
  const before = prefix === 'movie' ? current.movie : current.series

  const setClauses: string[] = []
  const values: unknown[] = []
  let touchedScoring = false

  for (const field of Object.keys(COLUMN_SUFFIX) as (keyof MediaTypeConfig)[]) {
    const value = updates[field]
    if (value === undefined) continue

    setClauses.push(`${prefix}_${COLUMN_SUFFIX[field]} = $${values.length + 1}`)
    values.push(value)

    // Tolerance because the weights round-trip through NUMERIC(3,2).
    if (SCORING_FIELDS.has(field) && Math.abs(value - before[field]) > 1e-9) {
      touchedScoring = true
    }
  }

  if (setClauses.length === 0) {
    return current
  }

  if (touchedScoring) {
    setClauses.push('scoring_updated_at = NOW()')
  }

  await query(
    `UPDATE recommendation_config SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = 1`,
    values
  )

  logger.info({ updates, touchedScoring }, `${prefix} recommendation config updated`)
  return getRecommendationConfig()
}

/**
 * Update movie recommendation configuration
 */
export async function updateMovieRecommendationConfig(
  updates: Partial<MediaTypeConfig>
): Promise<RecommendationConfig> {
  return updateConfigFor('movie', updates)
}

/**
 * Update series recommendation configuration
 */
export async function updateSeriesRecommendationConfig(
  updates: Partial<MediaTypeConfig>
): Promise<RecommendationConfig> {
  return updateConfigFor('series', updates)
}

/**
 * Legacy update function - updates movie config
 * @deprecated Use updateMovieRecommendationConfig instead
 */
export async function updateRecommendationConfig(
  updates: Partial<MediaTypeConfig>
): Promise<LegacyRecommendationConfig> {
  const config = await updateMovieRecommendationConfig(updates)
  return {
    ...config.movie,
    updatedAt: config.updatedAt,
  }
}

/**
 * Reset movie configuration to defaults
 */
export async function resetMovieRecommendationConfig(): Promise<RecommendationConfig> {
  // Goes through the shared setter so a reset can never miss a column a plain
  // update knows about; it always touches scoring fields, so the gate correctly
  // sees this as a reason to regenerate.
  await updateConfigFor('movie', MOVIE_DEFAULTS)

  logger.info('Movie recommendation config reset to defaults')
  return getRecommendationConfig()
}

/**
 * Reset series configuration to defaults
 */
export async function resetSeriesRecommendationConfig(): Promise<RecommendationConfig> {
  await updateConfigFor('series', SERIES_DEFAULTS)

  logger.info('Series recommendation config reset to defaults')
  return getRecommendationConfig()
}

/**
 * Legacy reset function - resets movie config
 * @deprecated Use resetMovieRecommendationConfig instead
 */
export async function resetRecommendationConfig(): Promise<LegacyRecommendationConfig> {
  const config = await resetMovieRecommendationConfig()
  return {
    ...config.movie,
    updatedAt: config.updatedAt,
  }
}
