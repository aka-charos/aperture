/**
 * User Algorithm Settings
 *
 * Allows end users to override admin-set recommendation algorithm weights.
 * Settings are stored in user_preferences.settings JSONB under 'algorithmSettings'.
 */

import { createChildLogger } from './logger.js'
import { query, queryOne } from './db.js'
import { getRecommendationConfig } from './recommendationConfig.js'
import type { PipelineConfig } from '../recommender/types.js'
// Pure leaf module, safe to import statically -- these are the same cut points
// tasteAnalyzer labels dispersion with, so "focused"/"eclectic" in a prompt and
// the diversity nudge here can't disagree about where the bands are.
import {
  DISPERSION_FOCUSED_THRESHOLD,
  DISPERSION_ECLECTIC_THRESHOLD,
} from '../taste-profile/clustering.js'

const logger = createChildLogger('user-algorithm-settings')

/**
 * User's custom algorithm settings for a media type
 */
export interface UserAlgorithmWeights {
  similarityWeight: number
  noveltyWeight: number
  ratingWeight: number
  diversityWeight: number
  recentWatchLimit: number
}

/**
 * Complete user algorithm settings structure
 */
export interface UserAlgorithmSettings {
  enabled: boolean
  movie?: Partial<UserAlgorithmWeights>
  series?: Partial<UserAlgorithmWeights>
}

/**
 * Default weights (matches admin defaults)
 */
const DEFAULT_WEIGHTS: UserAlgorithmWeights = {
  similarityWeight: 0.4,
  noveltyWeight: 0.2,
  ratingWeight: 0.2,
  diversityWeight: 0.2,
  recentWatchLimit: 50,
}

/**
 * Get user's custom algorithm settings
 */
export async function getUserAlgorithmSettings(userId: string): Promise<UserAlgorithmSettings | null> {
  const result = await queryOne<{ settings: { algorithmSettings?: UserAlgorithmSettings } | null }>(
    `SELECT settings FROM user_preferences WHERE user_id = $1`,
    [userId]
  )

  if (!result?.settings?.algorithmSettings) {
    return null
  }

  return result.settings.algorithmSettings
}

/**
 * Clamp user-supplied weight overrides to their valid ranges before storing.
 * `calculateBaseScore` (recommender/shared/scoring.ts) treats
 * similarity/novelty/rating weights as a true weighted average — that's
 * only bounded to [0,1] if the weights themselves are non-negative. The
 * admin config route validates this (settings/handlers/recommendations.ts),
 * but this is a *separate* write path (PATCH /api/users/:id/algorithm-settings)
 * with no schema validation of its own, so the invariant has to be enforced
 * here too. Mirrors the existing clamp-at-the-setter pattern already used
 * for franchise/genre preferences (taste-profile/index.ts).
 */
function clampWeights(
  weights: Partial<UserAlgorithmWeights> | undefined
): Partial<UserAlgorithmWeights> | undefined {
  if (!weights) return weights

  const clamped: Partial<UserAlgorithmWeights> = { ...weights }
  for (const key of [
    'similarityWeight',
    'noveltyWeight',
    'ratingWeight',
    'diversityWeight',
  ] as const) {
    if (clamped[key] !== undefined) {
      clamped[key] = Math.max(0, Math.min(1, clamped[key] as number))
    }
  }
  if (clamped.recentWatchLimit !== undefined) {
    clamped.recentWatchLimit = Math.max(1, clamped.recentWatchLimit)
  }
  return clamped
}

/**
 * Save user's custom algorithm settings
 */
export async function setUserAlgorithmSettings(
  userId: string,
  settings: UserAlgorithmSettings
): Promise<void> {
  const safeSettings: UserAlgorithmSettings = {
    enabled: settings.enabled,
    movie: clampWeights(settings.movie),
    series: clampWeights(settings.series),
  }

  // Ensure user_preferences row exists
  await query(
    `INSERT INTO user_preferences (user_id, settings)
     VALUES ($1, '{}')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  )

  // Update the algorithmSettings in the JSONB settings column
  await query(
    `UPDATE user_preferences
     SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('algorithmSettings', $2::jsonb),
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId, JSON.stringify(safeSettings)]
  )

  logger.info({ userId, enabled: safeSettings.enabled }, 'Updated user algorithm settings')
}

/**
 * Reset user's algorithm settings to admin defaults
 */
export async function resetUserAlgorithmSettings(userId: string): Promise<void> {
  await query(
    `UPDATE user_preferences 
     SET settings = settings - 'algorithmSettings',
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  )

  logger.info({ userId }, 'Reset user algorithm settings to defaults')
}

/**
 * Get the effective algorithm config for a user
 * 
 * Priority:
 * 1. User's custom settings (if enabled)
 * 2. Admin-configured defaults
 * 3. Fallback defaults
 */
export async function getEffectiveAlgorithmConfig(
  userId: string,
  mediaType: 'movie' | 'series'
): Promise<PipelineConfig> {
  // Start with admin defaults
  let adminConfig: PipelineConfig
  try {
    const dbConfig = await getRecommendationConfig()
    adminConfig = {
      maxCandidates: mediaType === 'movie' ? dbConfig.movie.maxCandidates : dbConfig.series.maxCandidates,
      selectedCount: mediaType === 'movie' ? dbConfig.movie.selectedCount : dbConfig.series.selectedCount,
      similarityWeight: mediaType === 'movie' ? dbConfig.movie.similarityWeight : dbConfig.series.similarityWeight,
      noveltyWeight: mediaType === 'movie' ? dbConfig.movie.noveltyWeight : dbConfig.series.noveltyWeight,
      ratingWeight: mediaType === 'movie' ? dbConfig.movie.ratingWeight : dbConfig.series.ratingWeight,
      diversityWeight: mediaType === 'movie' ? dbConfig.movie.diversityWeight : dbConfig.series.diversityWeight,
      recentWatchLimit: mediaType === 'movie' ? dbConfig.movie.recentWatchLimit : dbConfig.series.recentWatchLimit,
      twinThresholdK: mediaType === 'movie' ? dbConfig.movie.twinThresholdK : dbConfig.series.twinThresholdK,
      twinMaxSlots: mediaType === 'movie' ? dbConfig.movie.twinMaxSlots : dbConfig.series.twinMaxSlots,
    }
  } catch {
    logger.warn('Failed to load admin config, using fallback defaults')
    adminConfig = {
      maxCandidates: 50000,
      selectedCount: 20,
      twinThresholdK: 2.0,
      twinMaxSlots: 4,
      ...DEFAULT_WEIGHTS,
    }
  }

  // Check for user overrides
  const userSettings = await getUserAlgorithmSettings(userId)
  
  // If user has no custom settings or they're disabled, use admin config
  if (!userSettings || !userSettings.enabled) {
    return adminConfig
  }

  // Get user's media-type-specific overrides
  const userOverrides = mediaType === 'movie' ? userSettings.movie : userSettings.series
  
  // Merge user overrides with admin config (use raw values)
  const rawWeights = {
    similarityWeight: userOverrides?.similarityWeight ?? adminConfig.similarityWeight,
    noveltyWeight: userOverrides?.noveltyWeight ?? adminConfig.noveltyWeight,
    ratingWeight: userOverrides?.ratingWeight ?? adminConfig.ratingWeight,
    diversityWeight: userOverrides?.diversityWeight ?? adminConfig.diversityWeight,
    recentWatchLimit: userOverrides?.recentWatchLimit ?? adminConfig.recentWatchLimit,
  }
  
  // Normalize the weights so they sum to 1.0
  const normalizedWeights = normalizeWeights(rawWeights)
  
  const effectiveConfig: PipelineConfig = {
    maxCandidates: adminConfig.maxCandidates, // User can't override this
    selectedCount: adminConfig.selectedCount, // User can't override this
    twinThresholdK: adminConfig.twinThresholdK, // Instance-wide: the bar is derived from every pair
    twinMaxSlots: adminConfig.twinMaxSlots, // User can't override this
    ...normalizedWeights,
  }

  logger.debug(
    { userId, mediaType, rawWeights, effectiveConfig },
    'Computed effective algorithm config for user (normalized)'
  )

  return effectiveConfig
}

/**
 * Normalize weights so they sum to 1.0
 * Users can set any values they want, and we'll normalize on the backend
 */
export function normalizeWeights(weights: Partial<UserAlgorithmWeights>): UserAlgorithmWeights {
  const similarity = weights.similarityWeight ?? DEFAULT_WEIGHTS.similarityWeight
  const novelty = weights.noveltyWeight ?? DEFAULT_WEIGHTS.noveltyWeight
  const rating = weights.ratingWeight ?? DEFAULT_WEIGHTS.ratingWeight
  const diversity = weights.diversityWeight ?? DEFAULT_WEIGHTS.diversityWeight
  
  const sum = similarity + novelty + rating + diversity
  
  // Avoid division by zero
  if (sum === 0) {
    return DEFAULT_WEIGHTS
  }
  
  return {
    similarityWeight: similarity / sum,
    noveltyWeight: novelty / sum,
    ratingWeight: rating / sum,
    diversityWeight: diversity / sum,
    recentWatchLimit: weights.recentWatchLimit ?? DEFAULT_WEIGHTS.recentWatchLimit,
  }
}

/**
 * Get admin default config for display purposes
 */
export async function getAdminDefaultConfig(mediaType: 'movie' | 'series'): Promise<UserAlgorithmWeights> {
  try {
    const dbConfig = await getRecommendationConfig()
    const config = mediaType === 'movie' ? dbConfig.movie : dbConfig.series
    return {
      similarityWeight: config.similarityWeight,
      noveltyWeight: config.noveltyWeight,
      ratingWeight: config.ratingWeight,
      diversityWeight: config.diversityWeight,
      recentWatchLimit: config.recentWatchLimit,
    }
  } catch {
    return DEFAULT_WEIGHTS
  }
}

/**
 * Calculate smart diversity adjustment based on user's taste profile
 * 
 * - Focused taste (score < 0.3): Reduce diversity weight by 30%
 * - Balanced taste (0.3-0.6): Use default
 * - Eclectic taste (score > 0.6): Increase diversity weight by 20%
 * 
 * Only applies if user hasn't set a custom diversity weight.
 */
/**
 * Nudge a configured diversity weight by how spread out the user's taste is:
 * down for focused viewers, up for eclectic ones, unchanged when the dispersion
 * score carries no information.
 *
 * That last case is the reason this is a separate, testable function. A score
 * pinned to either end of the scale is a *clamp*, not a measurement -- the raw
 * cosine distance fell outside the [0.3, 0.8] window the score is rescaled
 * from, and clamping discards how far outside it was. Measured across 14 real
 * profiles the raw value sat between 0.238 and 0.254, entirely below that
 * floor, so every user scored exactly 0.000 and every user was handed the
 * "focused" x0.7 reduction on the strength of a number that said nothing about
 * them. The eclectic branch was unreachable for anybody.
 *
 * Declining to adjust is the honest response to an uninformative input; the
 * previous behavior was a confident judgement with nothing behind it. Until the
 * underlying measurement can discriminate between users, this is a no-op in
 * practice -- which is the point.
 */
export function adjustDiversityWeightForDispersion(
  baseWeight: number,
  dispersion: number
): number {
  const clamp = (w: number) => Math.max(0, Math.min(1, w))

  if (!Number.isFinite(dispersion) || dispersion <= 0 || dispersion >= 1) {
    return clamp(baseWeight)
  }

  if (dispersion < DISPERSION_FOCUSED_THRESHOLD) {
    // Focused taste - reduce diversity (they know what they like)
    return clamp(baseWeight * 0.7)
  }

  if (dispersion > DISPERSION_ECLECTIC_THRESHOLD) {
    // Eclectic taste - increase diversity (they enjoy variety). applyDiversitySelection
    // blends this as `base*(1-w) + diversity*w`, which only stays within [0,1]
    // if w does, so the 1.2x bump is clamped rather than trusted.
    return clamp(baseWeight * 1.2)
  }

  return clamp(baseWeight)
}

export async function getSmartDiversityWeight(
  userId: string,
  mediaType: 'movie' | 'series',
  baseDiversityWeight: number
): Promise<number> {
  try {
    // Check if user has custom settings
    const userSettings = await getUserAlgorithmSettings(userId)
    if (userSettings?.enabled) {
      const userOverrides = mediaType === 'movie' ? userSettings.movie : userSettings.series
      if (userOverrides?.diversityWeight !== undefined) {
        // User has explicitly set diversity weight, don't auto-adjust
        return userOverrides.diversityWeight
      }
    }

    // Get the user's taste dispersion. The stored cluster dispersion is the
    // same [0,1] score analyzeMovieTaste would report, so read it directly:
    // going through the full analysis meant four queries per user per
    // recommendation run (genres, decades, viewing patterns, and a 100-row
    // embedding scan) to use exactly one field of the result.
    const { getTasteDispersion } = await import('../taste-profile/index.js')
    let diversityScore = await getTasteDispersion(userId, mediaType)

    if (diversityScore === null) {
      // No clusters yet -- fall back to computing it the long way.
      const { analyzeMovieTaste, analyzeSeriesTaste } = await import('./tasteAnalyzer.js')
      const analysis =
        mediaType === 'movie' ? await analyzeMovieTaste(userId) : await analyzeSeriesTaste(userId)
      diversityScore = analysis.diversity.score
    }

    const adjusted = adjustDiversityWeightForDispersion(baseDiversityWeight, diversityScore)
    if (adjusted !== baseDiversityWeight) {
      logger.debug(
        { userId, mediaType, diversityScore, baseDiversityWeight, adjusted },
        'Applied taste-dispersion diversity adjustment'
      )
    }
    return adjusted
  } catch (err) {
    logger.warn({ err, userId, mediaType }, 'Failed to calculate smart diversity, using default')
    return baseDiversityWeight
  }
}

