/**
 * Taste Profile Builder
 *
 * Builds user taste profiles from watch history with engagement weighting.
 * The algorithm considers:
 * - Episode/movie count (logarithmic scaling)
 * - Completion rate (finished series = strong signal)
 * - Favorites (explicit positive signal)
 * - User ratings
 * - Recency (more recent = higher weight)
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { WATCH_HISTORY_TASTE_SQL } from '../recommender/watchedExclusion.js'
import { isDislikedRating, USER_RATING_SCALE_MAX } from '../recommender/ratingBands.js'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../lib/ai-provider.js'
import type { MediaType, WatchedItem } from './types.js'
import {
  chooseK,
  clusterTasteEmbeddings,
  l2Normalize,
  MAX_CLUSTERING_INPUT_ITEMS,
  MIN_MARGINAL_DISPERSION_REDUCTION,
  type WeightedEmbeddingItem,
  type ClusterCentroid,
  type ClusterAttempt,
} from './clustering.js'

const logger = createChildLogger('taste-profile-builder')

// ============================================================================
// Main Build Function
// ============================================================================

/**
 * Build a taste profile embedding from watch history
 */
export async function buildTasteProfile(
  userId: string,
  mediaType: MediaType
): Promise<number[] | null> {
  logger.info({ userId, mediaType }, 'Building taste profile')

  // Get watch history with engagement data
  const watchedItems =
    mediaType === 'movie'
      ? await getMovieWatchHistory(userId)
      : await getSeriesWatchHistory(userId)

  if (watchedItems.length === 0) {
    logger.warn({ userId, mediaType }, 'No watch history found, cannot build profile')
    return null
  }

  logger.info(
    { userId, mediaType, itemCount: watchedItems.length },
    `Found ${watchedItems.length} watched items for profile`
  )

  // Calculate engagement weights. Zero-weight items are dropped outright -- a
  // disliked title must not reach the average, and the total-weight-of-zero
  // guard in buildWeightedAverageEmbedding is a guard, not a filter.
  const weightedItems = watchedItems
    .map((item) => ({
      ...item,
      weight: calculateEngagementWeight(item, mediaType),
    }))
    .filter((item) => item.weight > 0)

  // Sort by weight to prioritize most engaging content
  weightedItems.sort((a, b) => b.weight - a.weight)

  // Log top weighted items for debugging
  const top5 = weightedItems.slice(0, 5)
  logger.debug(
    { userId, mediaType, topItems: top5.map((i) => ({ title: i.title, weight: i.weight.toFixed(3) })) },
    'Top 5 weighted items for profile'
  )

  // Get embeddings for watched items
  const embeddings = await getItemEmbeddings(
    weightedItems.map((i) => i.id),
    mediaType
  )

  if (embeddings.size === 0) {
    logger.warn({ userId, mediaType }, 'No embeddings found for watched items')
    return null
  }

  // Build weighted average embedding
  const profile = buildWeightedAverageEmbedding(weightedItems, embeddings)

  if (!profile) {
    logger.warn({ userId, mediaType }, 'Failed to build profile embedding')
    return null
  }

  logger.info(
    { userId, mediaType, embeddingDim: profile.length },
    'Successfully built taste profile'
  )

  return profile
}

export interface TasteClusterBuildResult {
  clusters: ClusterCentroid[]
  dispersion: number
}

/**
 * Build 1-3 per-user taste clusters from watch history, in place of the
 * single averaged centroid buildTasteProfile() produces. Independently
 * re-fetches watch history + embeddings via the same private helpers
 * buildTasteProfile() uses (no new SQL) -- deliberately decoupled from
 * buildTasteProfile() rather than threading shared data through both, so
 * clustering has its own isolated failure domain (see the try/catch around
 * its caller in taste-profile/index.ts) and buildTasteProfile()'s existing
 * behavior stays completely untouched.
 */
export async function buildTasteClusters(
  userId: string,
  mediaType: MediaType
): Promise<TasteClusterBuildResult | null> {
  logger.info({ userId, mediaType }, 'Building taste clusters')

  const watchedItems =
    mediaType === 'movie'
      ? await getMovieWatchHistory(userId)
      : await getSeriesWatchHistory(userId)

  if (watchedItems.length === 0) {
    return null
  }

  const weightedItems = watchedItems.map((item) => ({
    ...item,
    weight: calculateEngagementWeight(item, mediaType),
  }))
    // Same reason as buildTasteProfile: a disliked title must not become a
    // point the clustering can place a centroid on.
    .filter((item) => item.weight > 0)

  // Sorted by descending weight exactly as buildTasteProfile does above, and
  // for a second reason here: floating-point addition is not associative, so
  // summing the weighted embeddings in a different order would change the
  // result in its last bits. Matching the order is what makes the K=1 result
  // *bit-identical* to buildTasteProfile's, rather than merely very close.
  // (Array.prototype.sort is stable, and both paths sort the same rows from
  // the same query with the same comparator, so ties order identically too.)
  weightedItems.sort((a, b) => b.weight - a.weight)

  const embeddings = await getItemEmbeddings(
    weightedItems.map((i) => i.id),
    mediaType
  )

  if (embeddings.size === 0) {
    return null
  }

  const allItems: WeightedEmbeddingItem[] = weightedItems
    .filter((item) => embeddings.has(item.id))
    .map((item) => ({ id: item.id, weight: item.weight, embedding: embeddings.get(item.id)! }))

  if (allItems.length === 0) {
    return null
  }

  // K-selection and k>1 clustering run on a capped, highest-engagement-weight
  // subset to bound k-means cost for large watch histories (the queries above
  // have no LIMIT). allItems is already in descending-weight order, so this is
  // a plain prefix; the full allItems is what the K=1 path below uses.
  const cappedItems = allItems.slice(0, MAX_CLUSTERING_INPUT_ITEMS)

  const { k, dispersion, rawDispersion } = chooseK(cappedItems)

  // Collects what each attempted K decided and why, so the constants gating
  // those decisions can be calibrated from real watch histories instead of the
  // synthetic fixtures they were set against. See the diagnostics log below.
  const attempts: ClusterAttempt[] = []

  let clusters =
    k <= 1
      ? clusterTasteEmbeddings(allItems, 1, attempts)
      : clusterTasteEmbeddings(cappedItems, k, attempts)

  // Whenever exactly one cluster survives -- whether chooseK decided K=1 up
  // front, or a hard-floor step-down collapsed a larger K back down -- the
  // stored result must be the true full-history mean, not a capped-subset
  // approximation, so "K=1 == today's single-centroid behavior" is provable
  // rather than approximate.
  if (clusters.length === 1 && k > 1) {
    clusters = clusterTasteEmbeddings(allItems, 1)
  }

  if (clusters.length === 0) {
    logger.warn({ userId, mediaType }, 'Failed to build taste clusters')
    return null
  }

  logger.info(
    {
      userId,
      mediaType,
      clusterCount: clusters.length,
      dispersion: dispersion.toFixed(3),
      itemCounts: clusters.map((c) => c.itemCount),
    },
    'Successfully built taste clusters'
  )

  // One line per profile carrying every number behind the K decision. Emitted
  // separately from the line above so it can be grepped on its own, and at info
  // rather than debug because it exists to be collected from a live instance:
  // both MIN_MARGINAL_DISPERSION_REDUCTION and the 0.3-0.8 window
  // calculateWeightedDispersion rescales from were set against synthetic data,
  // and the first real instance produced K=1 and a normalized dispersion of
  // exactly 0.000 for every profile. rawDispersion is the unscaled measurement;
  // attempts[].reduction is what each K actually achieved against the 0.4 bar.
  logger.info(
    {
      userId,
      mediaType,
      itemsTotal: allItems.length,
      itemsClustered: cappedItems.length,
      desiredK: k,
      finalClusterCount: clusters.length,
      rawDispersion: Number(rawDispersion.toFixed(4)),
      normalizedDispersion: Number(dispersion.toFixed(4)),
      minReductionRequired: MIN_MARGINAL_DISPERSION_REDUCTION,
      attempts: attempts.map((a) => ({
        k: a.k,
        prev: Number(a.previousDistance.toFixed(4)),
        split: Number(a.splitDistance.toFixed(4)),
        reduction: Number(a.reduction.toFixed(4)),
        smallest: a.smallestCluster,
        kept: a.kept,
        rejectedFor: a.rejectedFor ?? null,
      })),
    },
    'CLUSTER-DIAG'
  )

  return { clusters, dispersion }
}

// ============================================================================
// Engagement Weight Calculation
// ============================================================================

/**
 * How much a series' completion rate scales its engagement weight.
 *
 * The denominator behind `completionRate` is the number of episodes **on the
 * media server**, never TMDB's aired total, and that is load-bearing: a user
 * who owns one season of a five-season show and watched it has finished
 * everything they had, and must not be penalised for content they don't hold.
 *
 * Exported so the bands are testable as a unit -- they are the one place where
 * "did they like it" is inferred rather than stated.
 */
export function completionMultiplier(completionRate: number | undefined): number {
  if (completionRate === undefined) return 1.0

  if (completionRate > 0.9) return 1.5 // finished it
  if (completionRate > 0.5) return 1.2 // committed to it
  if (completionRate >= 0.25) return 1.0 // neutral: could be a library gap
  if (completionRate >= 0.1) return 0.4 // sampled and drifted away
  return 0.25 // bounced off it
}

/**
 * Calculate engagement weight for a watched item
 *
 * Factors:
 * - Episode/movie count (log scale to prevent runaway)
 * - Completion rate (finished = strong signal, abandoned = negative signal)
 * - Favorites (explicit positive signal)
 * - User rating (if available)
 * - Recency (half-life decay)
 */
export function calculateEngagementWeight(item: WatchedItem, mediaType: MediaType): number {
  let weight = 1.0

  if (mediaType === 'series') {
    // Episode count weight (logarithmic to prevent runaway)
    // 10 episodes = 2.0, 100 episodes = 3.0, 1000 episodes = 4.0
    const episodeCount = item.episodeCount || 1
    weight *= 1 + Math.log10(Math.max(episodeCount, 1))

    // Completion moves the weight in BOTH directions. Bonuses alone were not
    // enough: people sample far more shows than they finish, so with the old
    // 1.0x floor forty abandoned shows outvoted five finished ones roughly
    // 2.5:1, and the taste vector was built mostly from shows the user
    // rejected. Dropping a show early is evidence, and it is negative.
    //
    // Nothing between 25% and 50% is penalised, deliberately: a user who
    // watched season one while season two was missing from the library, and
    // never noticed it arrive, has not told us anything bad about the show.
    // The bands above 50% stay bonuses for the same reason.
    weight *= completionMultiplier(item.completionRate)
  } else {
    // Movie: play count matters
    const playCount = item.playCount || 1
    weight *= 1 + Math.log10(Math.max(playCount, 1)) * 0.5
  }

  // Favorites bonus (explicit positive signal)
  if (item.hasFavorites) {
    weight *= 1.5
  }

  // User rating (if they bothered to rate it, it matters to them).
  //
  // A disliked title contributes NOTHING rather than a little: a weighted mean
  // can only express "more like this", so any positive weight pulls the centroid
  // toward what the viewer said they disliked. See recommender/ratingBands.ts.
  //
  // The scale is 1-10, fixed by the CHECK constraint on user_ratings. This used
  // to read `item.rating > 5 ? item.rating / 10 : item.rating / 5`, guessing at a
  // 1-5 scale that does not exist, which made the curve non-monotonic: 5/10 got
  // the maximum weight, tied with 10/10 and ahead of a 9, while a 6 scored below
  // a 4.
  if (item.rating !== undefined) {
    if (isDislikedRating(item.rating)) return 0
    const normalizedRating = item.rating / USER_RATING_SCALE_MAX
    // 4 -> 0.80x, 7 -> 1.03x, 10 -> 1.25x. Monotonic across the whole scale.
    weight *= 0.5 + normalizedRating * 0.75
  }

  // Recency factor (half-life of 180 days)
  // Items watched recently get higher weight
  if (item.lastPlayedAt) {
    const daysSince = (Date.now() - item.lastPlayedAt.getTime()) / (1000 * 60 * 60 * 24)
    // Half-life decay: weight halves every 180 days
    // But don't let it go below 0.25 (old items still matter somewhat)
    const recencyFactor = Math.max(0.25, Math.pow(0.5, daysSince / 180))
    weight *= recencyFactor
  }

  return weight
}

// ============================================================================
// Watch History Retrieval
// ============================================================================

/**
 * Get movie watch history with engagement data
 * Excludes movies from user-excluded libraries
 */
async function getMovieWatchHistory(userId: string): Promise<WatchedItem[]> {
  // Get user's excluded library IDs
  const { getUserExcludedLibraries } = await import('../lib/libraryExclusions.js')
  const excludedLibraryIds = await getUserExcludedLibraries(userId)
  
  // Build the exclusion clause
  const libraryExclusionClause = excludedLibraryIds.length > 0
    ? `AND (m.provider_library_id IS NULL OR m.provider_library_id NOT IN (${excludedLibraryIds.map((_, i) => `$${i + 2}`).join(', ')}))`
    : ''
  
  const result = await query<{
    id: string
    title: string
    play_count: number
    is_favorite: boolean
    last_played_at: Date | null
    user_rating: number | null
    genres: string[]
    collection_name: string | null
  }>(
    `SELECT 
       m.id,
       m.title,
       COALESCE(wh.play_count, 1) as play_count,
       COALESCE(wh.is_favorite, false) as is_favorite,
       wh.last_played_at,
       ur.rating as user_rating,
       m.genres,
       m.collection_name
     FROM watch_history wh
     JOIN movies m ON m.id = wh.movie_id
     LEFT JOIN user_ratings ur ON ur.movie_id = m.id AND ur.user_id = wh.user_id
     WHERE wh.user_id = $1 AND wh.media_type = 'movie'
       AND ${WATCH_HISTORY_TASTE_SQL}
     ${libraryExclusionClause}
     ORDER BY wh.last_played_at DESC NULLS LAST`,
    [userId, ...excludedLibraryIds]
  )

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    playCount: row.play_count,
    hasFavorites: row.is_favorite,
    lastPlayedAt: row.last_played_at,
    rating: row.user_rating ?? undefined,
    genres: row.genres || [],
    collectionName: row.collection_name ?? undefined,
  }))
}

/**
 * Shows the user favorited on the media server without playing an episode.
 *
 * These leave no watch_history rows at all -- the sync fetches favorited
 * *Episodes*, while favoriting a show in Emby/Jellyfin marks the *Series*
 * item -- so until now a show you explicitly flagged was invisible to the
 * taste profile. user_watching_series is the bidirectional mirror of those
 * server favorites (watching/favoriteSync.ts), which is why no new sync is
 * needed here.
 *
 * Caveat worth knowing: that mirror is only refreshed while the Watching
 * feature is enabled. With it off the table goes stale, and this contributes
 * nothing rather than contributing something wrong.
 *
 * Returned with no episode count and no completion rate, so the engagement
 * weight comes out at the favorites bonus alone -- a deliberate stance that a
 * flagged-but-unstarted show is a real but modest signal, well below a show
 * the user actually finished.
 */
async function getFavoritedSeriesWithoutHistory(userId: string): Promise<WatchedItem[]> {
  const { getUserExcludedLibraries } = await import('../lib/libraryExclusions.js')
  const excludedLibraryIds = await getUserExcludedLibraries(userId)

  const libraryExclusionClause =
    excludedLibraryIds.length > 0
      ? `AND (s.provider_library_id IS NULL OR s.provider_library_id NOT IN (${excludedLibraryIds
          .map((_, i) => `$${i + 2}`)
          .join(', ')}))`
      : ''

  const result = await query<{
    id: string
    title: string
    user_rating: number | null
    genres: string[]
    added_at: Date | null
  }>(
    `SELECT s.id, s.title, ur.rating as user_rating, s.genres, uws.added_at
       FROM user_watching_series uws
       JOIN series s ON s.id = uws.series_id
       LEFT JOIN user_ratings ur ON ur.series_id = s.id AND ur.user_id = uws.user_id
      WHERE uws.user_id = $1
        ${libraryExclusionClause}
        AND NOT EXISTS (
          SELECT 1
            FROM watch_history wh
            JOIN episodes e ON e.id = wh.episode_id
           WHERE wh.user_id = uws.user_id
             AND wh.media_type = 'episode'
             AND e.series_id = s.id
             AND ${WATCH_HISTORY_TASTE_SQL}
        )`,
    [userId, ...excludedLibraryIds]
  )

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    hasFavorites: true,
    playCount: 0,
    // Recency still applies, dated from when they flagged it -- the closest
    // thing to an interaction timestamp a never-played show has.
    lastPlayedAt: row.added_at,
    rating: row.user_rating ?? undefined,
    genres: row.genres || [],
  }))
}

/**
 * Get series watch history with engagement data
 * Excludes series from user-excluded libraries
 */
async function getSeriesWatchHistory(userId: string): Promise<WatchedItem[]> {
  // Get user's excluded library IDs
  const { getUserExcludedLibraries } = await import('../lib/libraryExclusions.js')
  const excludedLibraryIds = await getUserExcludedLibraries(userId)
  
  // Build the HAVING clause for library exclusion (since we're using GROUP BY)
  const libraryExclusionClause = excludedLibraryIds.length > 0
    ? `HAVING (MAX(s.provider_library_id) IS NULL OR MAX(s.provider_library_id) NOT IN (${excludedLibraryIds.map((_, i) => `$${i + 2}`).join(', ')}))`
    : ''
  
  const result = await query<{
    id: string
    title: string
    episodes_watched: number
    total_episodes: number | null
    has_favorites: boolean
    last_played_at: Date | null
    user_rating: number | null
    genres: string[]
  }>(
    `SELECT 
       s.id,
       s.title,
       COUNT(DISTINCT wh.episode_id) as episodes_watched,
       s.total_episodes,
       BOOL_OR(wh.is_favorite) as has_favorites,
       MAX(wh.last_played_at) as last_played_at,
       MAX(ur.rating) as user_rating,
       s.genres
     FROM watch_history wh
     JOIN episodes e ON e.id = wh.episode_id
     JOIN series s ON s.id = e.series_id
     LEFT JOIN user_ratings ur ON ur.series_id = s.id AND ur.user_id = wh.user_id
     WHERE wh.user_id = $1 AND wh.media_type = 'episode'
       AND ${WATCH_HISTORY_TASTE_SQL}
     GROUP BY s.id, s.title, s.total_episodes, s.genres
     ${libraryExclusionClause}
     ORDER BY MAX(wh.last_played_at) DESC NULLS LAST`,
    [userId, ...excludedLibraryIds]
  )

  const watched: WatchedItem[] = result.rows.map((row) => {
    const episodesWatched = parseInt(String(row.episodes_watched), 10)
    const totalEpisodes = row.total_episodes || undefined

    return {
      id: row.id,
      title: row.title,
      episodeCount: episodesWatched,
      totalEpisodes,
      completionRate: totalEpisodes ? episodesWatched / totalEpisodes : undefined,
      playCount: episodesWatched,
      hasFavorites: row.has_favorites,
      lastPlayedAt: row.last_played_at,
      rating: row.user_rating ?? undefined,
      genres: row.genres || [],
    }
  })

  // Shows flagged on the server but never started have no episode rows to
  // group, so they are fetched separately and appended. The NOT EXISTS in that
  // query is what keeps this from double-counting a show already above.
  return [...watched, ...(await getFavoritedSeriesWithoutHistory(userId))]
}

// ============================================================================
// Embedding Retrieval and Averaging
// ============================================================================

/**
 * Get embeddings for a list of items
 */
async function getItemEmbeddings(
  itemIds: string[],
  mediaType: MediaType
): Promise<Map<string, number[]>> {
  if (itemIds.length === 0) return new Map()

  const modelId = await getActiveEmbeddingModelId()
  if (!modelId) {
    logger.warn('No embedding model configured')
    return new Map()
  }

  const tableName =
    mediaType === 'movie'
      ? await getActiveEmbeddingTableName('embeddings')
      : await getActiveEmbeddingTableName('series_embeddings')

  const idColumn = mediaType === 'movie' ? 'movie_id' : 'series_id'

  const result = await query<{ item_id: string; embedding: string }>(
    `SELECT ${idColumn} as item_id, embedding::text as embedding
     FROM ${tableName}
     WHERE ${idColumn} = ANY($1) AND model = $2`,
    [itemIds, modelId]
  )

  const embeddings = new Map<string, number[]>()
  for (const row of result.rows) {
    embeddings.set(row.item_id, parseEmbedding(row.embedding))
  }

  return embeddings
}

/**
 * Build weighted average embedding from items and their weights
 */
function buildWeightedAverageEmbedding(
  items: Array<{ id: string; weight: number }>,
  embeddings: Map<string, number[]>
): number[] | null {
  // Get dimension from first embedding
  const firstEmbedding = embeddings.values().next().value
  if (!firstEmbedding) return null

  const dimension = firstEmbedding.length
  const result = new Array(dimension).fill(0)
  let totalWeight = 0

  // Unit-normalize each item before weighting it.
  //
  // A centroid is a SUM, not a comparison, and that distinction is the whole
  // point. The 31 places that compare vectors all use pgvector's <=>, which is
  // cosine and therefore magnitude-invariant, so an unnormalized vector costs
  // them nothing. Summing is different: it makes a title's influence
  // `weight * ||v||` instead of `weight`, quietly multiplying every tuned
  // number that feeds `item.weight` -- log10(episode count), the completion
  // bands, favourite x1.5, the 180-day recency half-life -- by an
  // uncontrolled per-title factor. The trailing L2 normalize below does NOT
  // fix that: it rescales the finished mean, long after the relative
  // contributions have been decided.
  //
  // On an instance embedding at a model's NATIVE dimension this is inert,
  // because the vectors already arrive unit-length -- gemini-embedding-001 at
  // 3072 is the case in front of us, so this fixes nothing that is currently
  // broken here. It stops being inert the moment the dimension is not native:
  // Google's own documentation says "you must manually normalize non-3072
  // dimensions", so every MRL-truncated setting (1536, 768, ...) returns
  // vectors whose norm depends on how much of that text's energy happened to
  // land in the kept dimensions. VALID_EMBEDDING_DIMENSIONS offers eight
  // choices and seven of them are truncations, so the correctness of the taste
  // vector should not rest on which one an operator picked.
  //
  // It also makes the two centroid paths agree by construction. The K>=2 path
  // has always fed l2Normalize'd vectors to spherical k-means (see the
  // UnitItem construction in clustering.ts), so at a truncated dimension the
  // same viewer's taste was computed under one rule at K=1 and a different one
  // at K>=2 -- and chooseK compared a raw-mean fallback against unit-based
  // clusters to decide between them.
  for (const item of items) {
    const embedding = embeddings.get(item.id)
    if (!embedding) continue

    const unit = l2Normalize(embedding)
    for (let i = 0; i < dimension; i++) {
      result[i] += unit[i] * item.weight
    }
    totalWeight += item.weight
  }

  if (totalWeight === 0) return null

  // Normalize
  for (let i = 0; i < dimension; i++) {
    result[i] /= totalWeight
  }

  // L2 normalize for cosine similarity
  const norm = Math.sqrt(result.reduce((sum, val) => sum + val * val, 0))
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      result[i] /= norm
    }
  }

  return result
}

/**
 * Parse embedding string from database
 */
function parseEmbedding(embeddingStr: string): number[] {
  const cleaned = embeddingStr.replace(/[[\]]/g, '')
  return cleaned.split(',').map((n) => parseFloat(n.trim()))
}

