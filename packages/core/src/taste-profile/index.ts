/**
 * User Taste Profile System
 *
 * Provides persistent, user-editable taste profiles that power recommendations,
 * similarity graphs, explore, and discovery features.
 */

import { query, queryOne, transaction } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import type {
  TasteProfile,
  FranchisePreference,
  GenreWeight,
  CustomInterest,
  MediaType,
  UserTasteData,
  ProfileBuildOptions,
} from './types.js'
import { DEFAULT_MIN_FRANCHISE_ITEMS, DEFAULT_MIN_FRANCHISE_SIZE } from './types.js'
import type { ClusterCentroid } from './clustering.js'
// Imported from the leaf module rather than recommender/shared/index.js: that
// barrel pulls in scoring/selection, and the recommender already imports this
// file. interestSlots.ts has no imports of its own, so there's no cycle.
import { interestAffinityFromSimilarity } from '../recommender/shared/interestSlots.js'

export * from './types.js'
export { 
  detectAndUpdateFranchises, 
  detectAndUpdateGenres, 
  detectFranchiseFromTitle,
  getItemFranchise,
  getItemFranchises,
  type DetectionResult,
  type DetectionOptions,
} from './franchise.js'

const logger = createChildLogger('taste-profile')

// ============================================================================
// Profile Retrieval
// ============================================================================

/**
 * Get a user's taste profile, building it if needed
 */
export async function getUserTasteProfile(
  userId: string,
  mediaType: MediaType,
  options: ProfileBuildOptions = {}
): Promise<TasteProfile | null> {
  const { forceRebuild = false, skipLockCheck = false, refreshPreferences = true } = options

  // Try to get existing profile
  const existing = await getStoredProfile(userId, mediaType)

  if (existing) {
    // Check if rebuild is needed due to staleness
    let needsRebuild = forceRebuild || isProfileStale(existing)

    // Also check if embedding model has changed (dimension mismatch prevention)
    // If the embedding exists, verify it matches the current model
    if (!needsRebuild && existing.embedding) {
      const { getActiveEmbeddingModelId } = await import('../lib/ai-provider.js')
      const currentModelId = await getActiveEmbeddingModelId()
      
      if (currentModelId) {
        // If we have no stored model info, we should rebuild to track it properly
        // If the model changed, we definitely need to rebuild
        if (!existing.embeddingModel) {
          logger.info(
            { userId, mediaType, newModel: currentModelId },
            'Profile missing embedding model info, rebuilding to ensure dimension compatibility'
          )
          needsRebuild = true
        } else if (currentModelId !== existing.embeddingModel) {
          logger.info(
            { userId, mediaType, oldModel: existing.embeddingModel, newModel: currentModelId },
            'Embedding model changed, profile needs rebuild to match new dimensions'
          )
          needsRebuild = true
        }
      }
    }

    if (!needsRebuild) {
      // Clusters are written only by the rebuild branch below, which a fresh
      // profile skips entirely -- so a user whose profile was last rebuilt
      // before multi-centroid retrieval shipped stays on the single-centroid
      // path until their profile next goes stale, up to refresh_interval_days
      // later (30 by default). That is exactly what happened on first deploy:
      // every profile had been rebuilt by the immediately-preceding release,
      // so none of them were stale, and user_taste_clusters stayed empty while
      // the feature looked deployed. This closes the gap on the next
      // recommendation run at the cost of one indexed COUNT.
      //
      // Deliberately not done in the locked branch below: a lock means "leave
      // my profile alone", and clusters are part of the profile.
      await backfillTasteClustersIfMissing(userId, mediaType)
      return existing
    }

    // Respect lock unless explicitly overridden
    if (existing.isLocked && !skipLockCheck) {
      logger.debug({ userId, mediaType }, 'Profile is locked, skipping rebuild')
      return existing
    }
  }

  // Build new profile
  logger.info({ userId, mediaType, forceRebuild }, 'Building taste profile')

  // Import builder dynamically to avoid circular dependencies
  const { buildTasteProfile } = await import('./builder.js')
  const newProfile = await buildTasteProfile(userId, mediaType)

  if (newProfile) {
    // Get current embedding model to store with profile
    const { getActiveEmbeddingModelId } = await import('../lib/ai-provider.js')
    const currentModelId = await getActiveEmbeddingModelId()

    await storeTasteProfile(userId, mediaType, newProfile, currentModelId || undefined)

    if (refreshPreferences) {
      await refreshDetectedPreferences(userId, mediaType, existing)
    }

    // Unconditional (not gated on refreshPreferences -- that flag is about
    // franchise/genre detection specifically, see its own doc comment).
    // Clusters have no independent refresh schedule of their own; they
    // rebuild in lockstep with the overall profile.
    await refreshTasteClusters(userId, mediaType, currentModelId || undefined)

    // Custom interests are not media-typed, so this runs on whichever profile
    // rebuilds first and the staleness filter makes the second call a no-op.
    await refreshCustomInterestEmbeddings(userId)

    return await getStoredProfile(userId, mediaType)
  }

  return existing // Return old profile if build failed
}

/**
 * Re-run franchise/genre auto-detection whenever the taste profile embedding
 * rebuilds (first build, or the periodic staleness refresh), so both signals
 * stay current as watch history grows instead of only ever being seeded once
 * — previously neither ran automatically on an ongoing basis; genre weights
 * in particular were only ever populated by the manual "rebuild profile"
 * settings action. Always uses 'merge' mode: auto-detected entries are
 * updated, but anything the user set by hand (`isUserSet`) is left alone.
 * Best-effort — a detection failure shouldn't block profile building, which
 * is the thing recommendations actually depend on.
 */
async function refreshDetectedPreferences(
  userId: string,
  mediaType: MediaType,
  existingProfile: TasteProfile | null
): Promise<void> {
  try {
    // Dynamic import to avoid circular deps (franchise.js imports from this
    // module) — same pattern used for the builder import above.
    const { detectAndUpdateFranchises, detectAndUpdateGenres } = await import('./franchise.js')

    const minFranchiseItems = existingProfile?.minFranchiseItems ?? DEFAULT_MIN_FRANCHISE_ITEMS
    const minFranchiseSize = existingProfile?.minFranchiseSize ?? DEFAULT_MIN_FRANCHISE_SIZE

    const [franchiseResult, genreResult] = await Promise.all([
      detectAndUpdateFranchises(userId, mediaType, { mode: 'merge', minFranchiseItems, minFranchiseSize }),
      detectAndUpdateGenres(userId, mediaType, { mode: 'merge' }),
    ])

    logger.info(
      {
        userId,
        mediaType,
        franchisesUpdated: franchiseResult.updated,
        genresUpdated: genreResult.updated,
      },
      'Refreshed auto-detected franchise/genre preferences alongside taste profile'
    )
  } catch (err) {
    logger.warn(
      { err, userId, mediaType },
      'Failed to refresh franchise/genre preferences, continuing with existing'
    )
  }
}

/**
 * Rebuild a user's taste clusters (see clustering.ts) alongside the overall
 * profile rebuild. Best-effort and isolated from the rest of the rebuild: a
 * clustering failure must never block the centroid rebuild that
 * recommendations actually depend on, so any error here is logged and
 * swallowed — the next successful cluster read just falls back to whatever
 * cluster rows existed from the last successful build, or none (which
 * recommender pipelines already treat as "use the single-centroid path").
 */
async function refreshTasteClusters(
  userId: string,
  mediaType: MediaType,
  embeddingModel?: string
): Promise<void> {
  try {
    const { buildTasteClusters } = await import('./builder.js')
    const result = await buildTasteClusters(userId, mediaType)
    if (result) {
      await storeTasteClusters(userId, mediaType, result.clusters, result.dispersion, embeddingModel)
    }
  } catch (err) {
    logger.warn(
      { err, userId, mediaType },
      'Failed to build taste clusters, continuing with single-centroid profile only'
    )
  }
}

/**
 * Build taste clusters for a profile that is fresh but has none.
 *
 * Only getUserTasteProfile's rebuild branch writes clusters, so any release
 * that adds or resets them cannot reach a user whose profile is not due for a
 * refresh. Cheap when clusters already exist -- one COUNT on
 * idx_user_taste_clusters_user_id -- and otherwise does exactly what the
 * rebuild branch would have done.
 *
 * Best-effort like refreshTasteClusters itself: a failure here must never stop
 * getUserTasteProfile returning the profile recommendations actually depend
 * on, and a user whose items have no embeddings simply retries next run.
 */
async function backfillTasteClustersIfMissing(
  userId: string,
  mediaType: MediaType
): Promise<void> {
  try {
    const stored = await queryOne<{ count: string }>(
      `SELECT COUNT(*) FROM user_taste_clusters WHERE user_id = $1 AND media_type = $2`,
      [userId, mediaType]
    )
    if (stored && parseInt(stored.count, 10) > 0) return

    const { getActiveEmbeddingModelId } = await import('../lib/ai-provider.js')
    const currentModelId = await getActiveEmbeddingModelId()

    logger.info({ userId, mediaType }, 'Profile is fresh but has no taste clusters, backfilling')
    await refreshTasteClusters(userId, mediaType, currentModelId || undefined)
  } catch (err) {
    logger.warn({ err, userId, mediaType }, 'Failed to backfill missing taste clusters')
  }
}

/**
 * Re-embed any custom interest whose stored embedding is missing or was made
 * with a different model than the one currently active.
 *
 * Until this existed, nothing ever called updateCustomInterestEmbedding:
 * interests were embedded once when they were created and never touched
 * again. After an embedding-model change every one of them was silently dead
 * — cosineSimilarity's length guard returns 0 for a dimension mismatch, which
 * maps to neutral affinity, so the feature stopped working with no error and
 * no log. Migration 0086 cleared them once as a one-off; this is the ongoing
 * path.
 *
 * Runs alongside the taste-profile rebuild rather than on a schedule of its
 * own, matching how taste clusters are handled. Best-effort throughout: an
 * embedding failure must never block profile building.
 */
async function refreshCustomInterestEmbeddings(userId: string): Promise<void> {
  try {
    const { getActiveEmbeddingModelId, getEmbeddingModelInstance } = await import(
      '../lib/ai-provider.js'
    )
    const modelId = await getActiveEmbeddingModelId()
    if (!modelId) return

    const interests = await getUserCustomInterests(userId)
    const stale = interests.filter(
      (interest) => !interest.embedding?.length || interest.embeddingModel !== modelId
    )
    if (stale.length === 0) return

    const { embed } = await import('ai')
    const model = await getEmbeddingModelInstance()

    let repaired = 0
    for (const interest of stale) {
      try {
        const result = await embed({ model, value: interest.interestText })
        await updateCustomInterestEmbedding(interest.id, result.embedding, modelId)
        repaired++
      } catch (err) {
        logger.warn({ err, userId, interestId: interest.id }, 'Failed to re-embed custom interest')
      }
    }

    if (repaired > 0) {
      logger.info(
        { userId, repaired, model: modelId },
        `Re-embedded ${repaired} custom interest(s) for the active embedding model`
      )
    }
  } catch (err) {
    logger.warn({ err, userId }, 'Custom interest embedding refresh failed')
  }
}

/**
 * Get stored profile from database
 */
export async function getStoredProfile(
  userId: string,
  mediaType: MediaType
): Promise<TasteProfile | null> {
  const result = await queryOne<{
    id: string
    user_id: string
    media_type: string
    embedding: string | null
    embedding_model: string | null
    auto_updated_at: Date | null
    user_modified_at: Date | null
    is_locked: boolean
    refresh_interval_days: number
    min_franchise_items: number
    min_franchise_size: number
    created_at: Date
  }>(
    `SELECT * FROM user_taste_profiles WHERE user_id = $1 AND media_type = $2`,
    [userId, mediaType]
  )

  if (!result) return null

  return {
    id: result.id,
    userId: result.user_id,
    mediaType: result.media_type as MediaType,
    embedding: result.embedding ? parseEmbedding(result.embedding) : null,
    embeddingModel: result.embedding_model,
    autoUpdatedAt: result.auto_updated_at,
    userModifiedAt: result.user_modified_at,
    isLocked: result.is_locked,
    refreshIntervalDays: result.refresh_interval_days,
    minFranchiseItems: result.min_franchise_items,
    minFranchiseSize: result.min_franchise_size,
    createdAt: result.created_at,
  }
}

/**
 * Check if a profile is stale and needs rebuilding
 */
export function isProfileStale(profile: TasteProfile): boolean {
  if (!profile.autoUpdatedAt) return true

  const daysSinceUpdate = (Date.now() - profile.autoUpdatedAt.getTime()) / (1000 * 60 * 60 * 24)
  return daysSinceUpdate > profile.refreshIntervalDays
}

/**
 * Get all taste data for a user (profile + franchises + genres + interests)
 */
export async function getUserTasteData(
  userId: string,
  mediaType: MediaType
): Promise<UserTasteData> {
  const [profile, franchises, genres, customInterests] = await Promise.all([
    getStoredProfile(userId, mediaType),
    getUserFranchisePreferences(userId, mediaType),
    getUserGenreWeights(userId),
    getUserCustomInterests(userId),
  ])

  return { profile, franchises, genres, customInterests }
}

// ============================================================================
// Profile Storage
// ============================================================================

/**
 * Store or update a taste profile
 */
export async function storeTasteProfile(
  userId: string,
  mediaType: MediaType,
  embedding: number[],
  embeddingModel?: string
): Promise<void> {
  const vectorStr = `[${embedding.join(',')}]`

  await query(
    `INSERT INTO user_taste_profiles (user_id, media_type, embedding, embedding_model, auto_updated_at)
     VALUES ($1, $2, $3::halfvec, $4, NOW())
     ON CONFLICT (user_id, media_type) 
     DO UPDATE SET 
       embedding = $3::halfvec,
       embedding_model = $4,
       auto_updated_at = NOW()`,
    [userId, mediaType, vectorStr, embeddingModel || null]
  )

  logger.info({ userId, mediaType }, 'Stored taste profile')
}

// ============================================================================
// Taste Clusters
// ============================================================================

export interface TasteCluster {
  id: string
  userId: string
  mediaType: MediaType
  clusterIndex: number
  embedding: number[]
  embeddingModel: string | null
  weight: number
  itemCount: number
  dispersion: number | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Get a user's taste clusters (1-3 per media type, ordered by descending
 * weight / ascending cluster_index -- index 0 is the dominant taste facet).
 *
 * Fails open to `[]` on any error, and also returns `[]` if the stored
 * clusters were built under a since-replaced embedding model (defensive:
 * avoids mixing dimensions into downstream pgvector queries; the next
 * profile rebuild repopulates them under the new model, same as
 * `getUserTasteProfile`'s own model-mismatch handling above). Every caller
 * treats an empty array as "use the single-centroid fallback", never as a
 * hard failure — see `recommender/movies/pipeline.ts` and
 * `recommender/series/pipeline.ts`.
 */
export async function getUserTasteClusters(userId: string, mediaType: MediaType): Promise<TasteCluster[]> {
  try {
    const result = await query<{
      id: string
      user_id: string
      media_type: string
      cluster_index: number
      embedding: string
      embedding_model: string | null
      weight: string
      item_count: number
      dispersion: string | null
      created_at: Date
      updated_at: Date
    }>(
      `SELECT id, user_id, media_type, cluster_index, embedding::text as embedding,
              embedding_model, weight, item_count, dispersion, created_at, updated_at
       FROM user_taste_clusters
       WHERE user_id = $1 AND media_type = $2
       ORDER BY cluster_index`,
      [userId, mediaType]
    )

    if (result.rows.length === 0) return []

    const { getActiveEmbeddingModelId } = await import('../lib/ai-provider.js')
    const currentModelId = await getActiveEmbeddingModelId()
    const storedModelId = result.rows[0].embedding_model
    if (currentModelId && storedModelId !== currentModelId) {
      logger.debug(
        { userId, mediaType, storedModelId, currentModelId },
        'Stored taste clusters built under a different embedding model, ignoring until next rebuild'
      )
      return []
    }

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      mediaType: row.media_type as MediaType,
      clusterIndex: row.cluster_index,
      embedding: parseEmbedding(row.embedding),
      embeddingModel: row.embedding_model,
      weight: parseFloat(row.weight),
      itemCount: row.item_count,
      dispersion: row.dispersion !== null ? parseFloat(row.dispersion) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  } catch (err) {
    logger.warn(
      { err, userId, mediaType },
      'Failed to load taste clusters, falling back to single-centroid profile'
    )
    return []
  }
}

/**
 * The user's stored taste-dispersion score in [0,1], or null if they have no
 * clusters yet.
 *
 * This is the number clustering already computed to decide K (clustering.ts
 * chooseK), persisted by storeTasteClusters -- one value per build, replicated
 * onto every cluster row, so any row answers. Reading it here is what lets
 * lib/tasteAnalyzer.ts and getSmartDiversityWeight stop recomputing the same
 * quantity from scratch: they were running a 100-row embedding scan per call
 * to derive a number already sitting in a column, with the same normalization
 * and the same 0.3/0.6 cut points written out twice.
 *
 * Deliberately a plain read with no fallback -- callers decide what to do with
 * null, since the only sensible fallback (recomputing) is exactly what each of
 * them already has.
 */
export async function getTasteDispersion(
  userId: string,
  mediaType: MediaType
): Promise<number | null> {
  try {
    const row = await queryOne<{ dispersion: string | null }>(
      `SELECT dispersion FROM user_taste_clusters
        WHERE user_id = $1 AND media_type = $2 AND dispersion IS NOT NULL
        LIMIT 1`,
      [userId, mediaType]
    )
    if (!row?.dispersion) return null

    const dispersion = parseFloat(row.dispersion)
    return Number.isFinite(dispersion) ? dispersion : null
  } catch (err) {
    logger.warn({ err, userId, mediaType }, 'Failed to read stored taste dispersion')
    return null
  }
}

/**
 * Atomically replace a user's taste clusters (delete+insert in one
 * transaction, mirroring the "full replace" semantics `storeTasteProfile`
 * already uses for the single centroid) so a concurrent read never observes
 * a partial cluster set mid-rebuild.
 */
export async function storeTasteClusters(
  userId: string,
  mediaType: MediaType,
  clusters: ClusterCentroid[],
  dispersion: number,
  embeddingModel?: string
): Promise<void> {
  await transaction(async (client) => {
    await client.query(`DELETE FROM user_taste_clusters WHERE user_id = $1 AND media_type = $2`, [
      userId,
      mediaType,
    ])

    for (const cluster of clusters) {
      const vectorStr = `[${cluster.embedding.join(',')}]`
      await client.query(
        `INSERT INTO user_taste_clusters
           (user_id, media_type, cluster_index, embedding, embedding_model, weight, item_count, dispersion)
         VALUES ($1, $2, $3, $4::halfvec, $5, $6, $7, $8)`,
        [
          userId,
          mediaType,
          cluster.clusterIndex,
          vectorStr,
          embeddingModel || null,
          cluster.weight,
          cluster.itemCount,
          dispersion,
        ]
      )
    }
  })

  logger.info({ userId, mediaType, clusterCount: clusters.length }, 'Stored taste clusters')
}

/**
 * Update profile settings (lock, refresh interval, min franchise items/size)
 */
export async function updateProfileSettings(
  userId: string,
  mediaType: MediaType,
  settings: { isLocked?: boolean; refreshIntervalDays?: number; minFranchiseItems?: number; minFranchiseSize?: number }
): Promise<void> {
  const updates: string[] = []
  const values: (string | boolean | number)[] = [userId, mediaType]
  let paramIndex = 3

  if (settings.isLocked !== undefined) {
    updates.push(`is_locked = $${paramIndex}`)
    values.push(settings.isLocked)
    paramIndex++
  }

  if (settings.refreshIntervalDays !== undefined) {
    updates.push(`refresh_interval_days = $${paramIndex}`)
    values.push(settings.refreshIntervalDays)
    paramIndex++
  }

  if (settings.minFranchiseItems !== undefined) {
    updates.push(`min_franchise_items = $${paramIndex}`)
    values.push(settings.minFranchiseItems)
    paramIndex++
  }

  if (settings.minFranchiseSize !== undefined) {
    updates.push(`min_franchise_size = $${paramIndex}`)
    values.push(settings.minFranchiseSize)
    paramIndex++
  }

  if (updates.length === 0) return

  updates.push('user_modified_at = NOW()')

  await query(
    `UPDATE user_taste_profiles 
     SET ${updates.join(', ')}
     WHERE user_id = $1 AND media_type = $2`,
    values
  )

  logger.info({ userId, mediaType, settings }, 'Updated profile settings')
}

/**
 * Invalidate a profile (mark for rebuild on next access)
 */
export async function invalidateProfile(userId: string, mediaType: MediaType): Promise<void> {
  await query(
    `UPDATE user_taste_profiles 
     SET auto_updated_at = NULL 
     WHERE user_id = $1 AND media_type = $2`,
    [userId, mediaType]
  )

  logger.info({ userId, mediaType }, 'Invalidated taste profile')
}

// ============================================================================
// Franchise Preferences
// ============================================================================

/**
 * Get user's franchise preferences
 */
export async function getUserFranchisePreferences(
  userId: string,
  mediaType?: MediaType
): Promise<FranchisePreference[]> {
  const mediaFilter = mediaType ? `AND (media_type = $2 OR media_type = 'both')` : ''
  const params = mediaType ? [userId, mediaType] : [userId]

  const result = await query<{
    id: string
    user_id: string
    franchise_name: string
    media_type: string
    preference_score: string
    is_user_set: boolean
    items_watched: number
    total_engagement: number
    created_at: Date
    updated_at: Date
  }>(
    `SELECT * FROM user_franchise_preferences 
     WHERE user_id = $1 ${mediaFilter}
     ORDER BY total_engagement DESC`,
    params
  )

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    franchiseName: row.franchise_name,
    mediaType: row.media_type as MediaType | 'both',
    preferenceScore: parseFloat(row.preference_score),
    isUserSet: row.is_user_set,
    itemsWatched: row.items_watched,
    totalEngagement: row.total_engagement,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

/**
 * Update or create a franchise preference
 */
export async function setFranchisePreference(
  userId: string,
  franchiseName: string,
  mediaType: MediaType | 'both',
  preferenceScore: number,
  isUserSet: boolean = true
): Promise<void> {
  // Clamp score to -1 to 1
  const clampedScore = Math.max(-1, Math.min(1, preferenceScore))

  await query(
    `INSERT INTO user_franchise_preferences 
       (user_id, franchise_name, media_type, preference_score, is_user_set)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, franchise_name, media_type) 
     DO UPDATE SET 
       preference_score = $4,
       is_user_set = $5`,
    [userId, franchiseName, mediaType, clampedScore, isUserSet]
  )

  logger.info({ userId, franchiseName, mediaType, preferenceScore: clampedScore }, 'Set franchise preference')
}

/**
 * Bulk update franchise preferences (from auto-detection)
 * @param clearFirst - If true, deletes franchises for the given mediaType before inserting (for reset mode)
 *                     This includes user-set franchises since reset should start completely fresh
 * @param targetMediaType - The media type to clear when clearFirst is true (only clears that type)
 */
export async function bulkUpdateFranchisePreferences(
  userId: string,
  franchises: Array<{
    franchiseName: string
    mediaType: MediaType | 'both'
    preferenceScore: number
    itemsWatched: number
    totalEngagement: number
  }>,
  clearFirst: boolean = false,
  targetMediaType?: MediaType
): Promise<number> {
  // In reset mode, clear franchises for the target media type only
  // This ensures excluded libraries don't leave orphan preferences
  if (clearFirst && targetMediaType) {
    await query(
      `DELETE FROM user_franchise_preferences WHERE user_id = $1 AND media_type = $2`,
      [userId, targetMediaType]
    )
    logger.debug({ userId, targetMediaType }, 'Cleared franchise preferences for media type')
  } else if (clearFirst) {
    // Fallback: clear all if no targetMediaType specified (legacy behavior)
    await query(`DELETE FROM user_franchise_preferences WHERE user_id = $1`, [userId])
    logger.debug({ userId }, 'Cleared all franchise preferences for reset')
  }

  let updated = 0

  for (const franchise of franchises) {
    // Only update auto-detected preferences, don't overwrite user-set ones
    const result = await query(
      `INSERT INTO user_franchise_preferences 
         (user_id, franchise_name, media_type, preference_score, is_user_set, items_watched, total_engagement)
       VALUES ($1, $2, $3, $4, false, $5, $6)
       ON CONFLICT (user_id, franchise_name, media_type) 
       DO UPDATE SET 
         preference_score = CASE WHEN user_franchise_preferences.is_user_set THEN user_franchise_preferences.preference_score ELSE $4 END,
         items_watched = $5,
         total_engagement = $6
       WHERE NOT user_franchise_preferences.is_user_set OR user_franchise_preferences.items_watched != $5`,
      [
        userId,
        franchise.franchiseName,
        franchise.mediaType,
        franchise.preferenceScore,
        franchise.itemsWatched,
        franchise.totalEngagement,
      ]
    )
    if (result.rowCount && result.rowCount > 0) updated++
  }

  return updated
}

/**
 * Delete a franchise preference (user wants to remove it completely)
 */
export async function deleteFranchisePreference(
  userId: string,
  franchiseName: string,
  mediaType: MediaType | 'both'
): Promise<boolean> {
  const result = await query(
    `DELETE FROM user_franchise_preferences 
     WHERE user_id = $1 AND franchise_name = $2 AND media_type = $3`,
    [userId, franchiseName, mediaType]
  )
  
  logger.info({ userId, franchiseName, mediaType }, 'Deleted franchise preference')
  return (result.rowCount ?? 0) > 0
}

// ============================================================================
// Genre Weights
// ============================================================================

/**
 * Get user's genre weights
 */
export async function getUserGenreWeights(userId: string): Promise<GenreWeight[]> {
  const result = await query<{
    id: string
    user_id: string
    genre: string
    weight: string
    is_user_set: boolean
    created_at: Date
    updated_at: Date
  }>(
    `SELECT * FROM user_genre_weights WHERE user_id = $1 ORDER BY genre`,
    [userId]
  )

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    genre: row.genre,
    weight: parseFloat(row.weight),
    isUserSet: row.is_user_set,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

/**
 * Set a genre weight
 */
export async function setGenreWeight(
  userId: string,
  genre: string,
  weight: number,
  isUserSet: boolean = true
): Promise<void> {
  // Clamp weight to 0 to 2
  const clampedWeight = Math.max(0, Math.min(2, weight))

  await query(
    `INSERT INTO user_genre_weights (user_id, genre, weight, is_user_set)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, genre) 
     DO UPDATE SET weight = $3, is_user_set = $4`,
    [userId, genre, clampedWeight, isUserSet]
  )

  logger.info({ userId, genre, weight: clampedWeight }, 'Set genre weight')
}

/**
 * Bulk update genre weights
 */
/**
 * Bulk update genre weights (from auto-detection)
 * @param clearFirst - If true, deletes ALL genres before inserting (for reset mode)
 *                     This includes user-set genres since reset should start completely fresh
 */
export async function bulkUpdateGenreWeights(
  userId: string,
  genres: Array<{ genre: string; weight: number }>,
  clearFirst: boolean = false
): Promise<number> {
  // In reset mode, clear ALL genres (including user-set) to start fresh
  // This ensures excluded libraries don't leave orphan preferences
  if (clearFirst) {
    await query(
      `DELETE FROM user_genre_weights WHERE user_id = $1`,
      [userId]
    )
    logger.debug({ userId }, 'Cleared all genre weights for reset')
  }

  let updated = 0

  for (const { genre, weight } of genres) {
    const clampedWeight = Math.max(0, Math.min(2, weight))
    const result = await query(
      `INSERT INTO user_genre_weights (user_id, genre, weight, is_user_set)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (user_id, genre) 
       DO UPDATE SET weight = $3
       WHERE NOT user_genre_weights.is_user_set`,
      [userId, genre, clampedWeight]
    )
    if (result.rowCount && result.rowCount > 0) updated++
  }

  return updated
}

/**
 * Delete a genre weight (user wants to remove it completely)
 */
export async function deleteGenreWeight(
  userId: string,
  genre: string
): Promise<boolean> {
  const result = await query(
    `DELETE FROM user_genre_weights WHERE user_id = $1 AND genre = $2`,
    [userId, genre]
  )
  
  logger.info({ userId, genre }, 'Deleted genre weight')
  return (result.rowCount ?? 0) > 0
}

// ============================================================================
// Custom Interests
// ============================================================================

/**
 * Get user's custom interests
 */
export async function getUserCustomInterests(userId: string): Promise<CustomInterest[]> {
  const result = await query<{
    id: string
    user_id: string
    interest_text: string
    embedding: string | null
    embedding_model: string | null
    weight: string
    created_at: Date
  }>(
    `SELECT * FROM user_custom_interests WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  )

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    interestText: row.interest_text,
    embedding: row.embedding ? parseEmbedding(row.embedding) : null,
    embeddingModel: row.embedding_model,
    weight: parseFloat(row.weight),
    createdAt: row.created_at,
  }))
}

/**
 * Add a custom interest
 */
export async function addCustomInterest(
  userId: string,
  interestText: string,
  embedding?: number[],
  embeddingModel?: string,
  weight: number = 1.0
): Promise<string> {
  const vectorStr = embedding ? `[${embedding.join(',')}]` : null

  const result = await queryOne<{ id: string }>(
    `INSERT INTO user_custom_interests (user_id, interest_text, embedding, embedding_model, weight)
     VALUES ($1, $2, $3::halfvec, $4, $5)
     RETURNING id`,
    [userId, interestText, vectorStr, embeddingModel || null, weight]
  )

  logger.info({ userId, interestText }, 'Added custom interest')
  return result!.id
}

/**
 * Remove a custom interest
 */
export async function removeCustomInterest(userId: string, interestId: string): Promise<void> {
  await query(
    `DELETE FROM user_custom_interests WHERE id = $1 AND user_id = $2`,
    [interestId, userId]
  )

  logger.info({ userId, interestId }, 'Removed custom interest')
}

/**
 * Update custom interest embedding (after generating it)
 */
export async function updateCustomInterestEmbedding(
  interestId: string,
  embedding: number[],
  embeddingModel: string
): Promise<void> {
  const vectorStr = `[${embedding.join(',')}]`

  await query(
    `UPDATE user_custom_interests 
     SET embedding = $2::halfvec, embedding_model = $3
     WHERE id = $1`,
    [interestId, vectorStr, embeddingModel]
  )
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse embedding string from database
 */
function parseEmbedding(embeddingStr: string): number[] {
  // Remove brackets and split by comma
  const cleaned = embeddingStr.replace(/[[\]]/g, '')
  return cleaned.split(',').map((n) => parseFloat(n.trim()))
}

/**
 * Get the franchise affinity for a given item: 0 (avoid) - 0.5 (neutral, or
 * no preference recorded) - 1 (loved). Feeds `applyPreferenceAdjustment`
 * (core recommender/shared/scoring.ts), which treats 0.5 as a true no-op.
 */
export async function getFranchiseAffinity(
  userId: string,
  franchiseName: string | null | undefined,
  mediaType: MediaType
): Promise<number> {
  if (!franchiseName) return 0.5

  const pref = await queryOne<{ preference_score: string }>(
    `SELECT preference_score FROM user_franchise_preferences
     WHERE user_id = $1 AND franchise_name = $2 AND (media_type = $3 OR media_type = 'both')`,
    [userId, franchiseName, mediaType]
  )

  if (!pref) return 0.5

  return franchiseAffinityFromScore(parseFloat(pref.preference_score))
}

/**
 * preference_score is stored clamped to -1..1 (see setFranchisePreference):
 * -1 = avoid, 0 = neutral, 1 = loved. Shared by getFranchiseAffinity and
 * getFranchiseAffinityMap so the single-row and bulk paths can't drift.
 */
function franchiseAffinityFromScore(score: number): number {
  return 0.5 + score * 0.5
}

/**
 * Every franchise affinity a user has, keyed by franchise name, in one query.
 *
 * The recommendation pipelines need an affinity for each of ~12k candidates
 * per run; asking per candidate meant a sequential round trip each time even
 * though the answer set is small and fixed for the whole run. Franchises the
 * user has no row for are absent, so callers read `map.get(name) ?? 0.5` --
 * the same neutral default getFranchiseAffinity returns.
 *
 * A franchise can carry both a media-type-specific row and a 'both' row
 * (UNIQUE is on user_id + franchise_name + media_type, migration 0085). The
 * specific row wins here. getFranchiseAffinity's single-row query has no
 * ORDER BY, so which of the two it saw was up to Postgres.
 */
export async function getFranchiseAffinityMap(
  userId: string,
  mediaType: MediaType
): Promise<Map<string, number>> {
  const result = await query<{ franchise_name: string; preference_score: string }>(
    `SELECT franchise_name, preference_score
       FROM user_franchise_preferences
      WHERE user_id = $1 AND (media_type = $2 OR media_type = 'both')
      -- 'both' rows first, so a media-type-specific row overwrites them below
      ORDER BY (media_type = 'both') DESC`,
    [userId, mediaType]
  )

  const affinities = new Map<string, number>()
  for (const row of result.rows) {
    affinities.set(row.franchise_name, franchiseAffinityFromScore(parseFloat(row.preference_score)))
  }

  return affinities
}

/**
 * Get the genre affinity for a candidate's genres: 0 (avoid) - 0.5 (neutral,
 * or no weights set) - 1 (loved).
 */
export async function getGenreAffinity(userId: string, genres: string[]): Promise<number> {
  if (genres.length === 0) return 0.5

  const weights = await getUserGenreWeights(userId)
  return genreAffinityFromWeights(buildGenreWeightMap(weights), genres)
}

/**
 * Index a user's genre weights for repeated lookup. Split out with
 * genreAffinityFromWeights so the recommendation pipelines can fetch the
 * weights once per run: getGenreAffinity was being called once per candidate,
 * which meant issuing the byte-identical `WHERE user_id = $1` query 12k+ times
 * per user to get back the same rows every time.
 */
export function buildGenreWeightMap(weights: GenreWeight[]): Map<string, number> {
  return new Map(weights.map((w) => [w.genre.toLowerCase(), w.weight]))
}

/**
 * The genre-affinity math with the fetch lifted out: 0 (avoid) - 0.5 (neutral,
 * or no weights set) - 1 (loved). Both the per-call and per-run paths go
 * through this, so they cannot drift.
 */
export function genreAffinityFromWeights(
  weightMap: Map<string, number>,
  genres: string[]
): number {
  if (genres.length === 0) return 0.5

  let totalWeight = 0
  let count = 0

  for (const genre of genres) {
    const weight = weightMap.get(genre.toLowerCase())
    if (weight !== undefined) {
      totalWeight += weight
      count++
    }
  }

  if (count === 0) return 0.5

  // weight is stored clamped to 0..2 (see setGenreWeight), 1 = neutral
  const avgWeight = totalWeight / count
  return avgWeight / 2
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dotProduct / denominator
}

/**
 * Get the custom interest affinity for a candidate: 0.5 (no match, or no
 * custom interests configured) - 1 (strong match). Never goes below neutral
 * — custom interests are opt-in extra signal, not an aversion list.
 *
 * Checks if the candidate's embedding is similar to any of the user's custom
 * interests (e.g., "I love time travel stories", "space opera adventures").
 *
 * @param userId - The user ID
 * @param candidateEmbedding - The candidate's embedding vector
 */
export async function getCustomInterestAffinity(
  userId: string,
  candidateEmbedding: number[]
): Promise<number> {
  const interests = await getUserCustomInterests(userId)

  // No custom interests = neutral
  if (interests.length === 0) return 0.5

  // Filter to interests that have embeddings
  const interestsWithEmbeddings = interests.filter((i) => i.embedding && i.embedding.length > 0)
  if (interestsWithEmbeddings.length === 0) return 0.5

  // Find max similarity to any interest, weighted by user's interest weight
  let maxWeightedSimilarity = 0

  for (const interest of interestsWithEmbeddings) {
    if (!interest.embedding) continue

    const similarity = cosineSimilarity(candidateEmbedding, interest.embedding)
    const weightedSimilarity = similarity * interest.weight

    if (weightedSimilarity > maxWeightedSimilarity) {
      maxWeightedSimilarity = weightedSimilarity
    }
  }

  // Tiering lives in recommender/shared/interestSlots.ts so this and the
  // recommendation pipeline's bulk path can't drift apart.
  return interestAffinityFromSimilarity(maxWeightedSimilarity)
}
