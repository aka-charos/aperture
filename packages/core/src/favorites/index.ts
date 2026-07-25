/**
 * User favorites — write movies/series to the requesting user's own media-server
 * favorites (Emby/Jellyfin), resolving our internal ids to provider item ids.
 */

import { createChildLogger } from '../lib/logger.js'
import { query, queryOne } from '../lib/db.js'
import { getMediaServerProvider } from '../media/index.js'
import { getMediaServerApiKey } from '../settings/systemSettings.js'

const logger = createChildLogger('favorites')

export interface SetFavoritesResult {
  /** Items resolved to a provider id and (un)favorited. */
  updated: number
  /** Items skipped because they have no provider id (not in the library). */
  skipped: number
}

/** Favorited subsets of the requested ids, in our own internal id space. */
export interface FavoriteStatusesResult {
  movieIds: string[]
  seriesIds: string[]
}

/** One internal id paired with the provider item id it resolves to. */
interface ProviderIdPair {
  internalId: string
  providerItemId: string
  kind: 'movie' | 'series'
}

/**
 * Map internal ids → provider item ids while KEEPING the link back to the
 * internal id (unlike getProviderItemIds, which flattens it away). Needed to
 * report per-item status against the ids the caller asked about.
 */
async function getProviderIdPairs(
  movieIds: string[],
  seriesIds: string[]
): Promise<ProviderIdPair[]> {
  const pairs: ProviderIdPair[] = []

  if (movieIds.length > 0) {
    const movies = await query<{ id: string; provider_item_id: string }>(
      'SELECT id, provider_item_id FROM movies WHERE id = ANY($1) AND provider_item_id IS NOT NULL',
      [movieIds]
    )
    pairs.push(
      ...movies.rows.map((m) => ({
        internalId: m.id,
        providerItemId: m.provider_item_id,
        kind: 'movie' as const,
      }))
    )
  }

  if (seriesIds.length > 0) {
    const series = await query<{ id: string; provider_item_id: string }>(
      'SELECT id, provider_item_id FROM series WHERE id = ANY($1) AND provider_item_id IS NOT NULL',
      [seriesIds]
    )
    pairs.push(
      ...series.rows.map((s) => ({
        internalId: s.id,
        providerItemId: s.provider_item_id,
        kind: 'series' as const,
      }))
    )
  }

  return pairs
}

/**
 * Map internal movie/series ids → provider item ids, skipping any without a provider id.
 */
async function getProviderItemIds(movieIds: string[], seriesIds: string[]): Promise<string[]> {
  const itemIds: string[] = []

  if (movieIds.length > 0) {
    const movies = await query<{ provider_item_id: string }>(
      'SELECT provider_item_id FROM movies WHERE id = ANY($1) AND provider_item_id IS NOT NULL',
      [movieIds]
    )
    itemIds.push(...movies.rows.map((m) => m.provider_item_id))
  }

  if (seriesIds.length > 0) {
    const series = await query<{ provider_item_id: string }>(
      'SELECT provider_item_id FROM series WHERE id = ANY($1) AND provider_item_id IS NOT NULL',
      [seriesIds]
    )
    itemIds.push(...series.rows.map((s) => s.provider_item_id))
  }

  return itemIds
}

/**
 * Mark (or unmark) movies/series as favorites in the user's own media-server account.
 * Favorites are per-user and private to that account.
 */
export async function setFavoritesForUser(
  userId: string,
  movieIds: string[],
  seriesIds: string[],
  favorite: boolean
): Promise<SetFavoritesResult> {
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()

  if (!apiKey) {
    throw new Error('Media server API key is not configured')
  }

  // Resolve the user's media-server account so favorites land in their own profile.
  const user = await queryOne<{ provider_user_id: string }>(
    'SELECT provider_user_id FROM users WHERE id = $1',
    [userId]
  )

  if (!user?.provider_user_id) {
    throw new Error('User is not linked to media server')
  }

  const totalRequested = movieIds.length + seriesIds.length
  const itemIds = await getProviderItemIds(movieIds, seriesIds)
  const skipped = totalRequested - itemIds.length

  let updated = 0
  for (const itemId of itemIds) {
    if (favorite) {
      await provider.favoriteItem(apiKey, user.provider_user_id, itemId)
    } else {
      await provider.unfavoriteItem(apiKey, user.provider_user_id, itemId)
    }
    updated++
  }

  // Mirror into our own watch history rows so the UI reflects the change
  // immediately instead of waiting for the next sync job.
  if (movieIds.length > 0) {
    await query(
      'UPDATE watch_history SET is_favorite = $1 WHERE user_id = $2 AND movie_id = ANY($3)',
      [favorite, userId, movieIds]
    )
  }

  logger.info({ userId, favorite, updated, skipped }, 'Updated user favorites')

  return { updated, skipped }
}

/**
 * Whether a movie/series is currently favorited in the user's media-server account.
 * Items without a provider id (not in the library) report false.
 */
export async function getFavoriteStatusForUser(
  userId: string,
  item: { movieId?: string; seriesId?: string }
): Promise<boolean> {
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()

  if (!apiKey) {
    throw new Error('Media server API key is not configured')
  }

  const user = await queryOne<{ provider_user_id: string }>(
    'SELECT provider_user_id FROM users WHERE id = $1',
    [userId]
  )

  if (!user?.provider_user_id) {
    throw new Error('User is not linked to media server')
  }

  const itemIds = await getProviderItemIds(
    item.movieId ? [item.movieId] : [],
    item.seriesId ? [item.seriesId] : []
  )
  if (itemIds.length === 0) return false

  return provider.isItemFavorite(apiKey, user.provider_user_id, itemIds[0])
}

/** Media-server lookups run concurrently, but bounded so a big list can't flood it. */
const STATUS_CONCURRENCY = 8

/**
 * Favorite status for MANY items in one call — so a list of cards doesn't need
 * one HTTP round trip each just to know which hearts are already filled.
 *
 * Returns only the favorited ids (a subset of what was asked). Items with no
 * provider id, or whose lookup fails, are simply absent rather than throwing:
 * an unknown status must degrade to "not favorited", never to a broken list.
 */
export async function getFavoriteStatusesForUser(
  userId: string,
  movieIds: string[],
  seriesIds: string[]
): Promise<FavoriteStatusesResult> {
  const result: FavoriteStatusesResult = { movieIds: [], seriesIds: [] }
  if (movieIds.length === 0 && seriesIds.length === 0) return result

  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()

  if (!apiKey) {
    throw new Error('Media server API key is not configured')
  }

  const user = await queryOne<{ provider_user_id: string }>(
    'SELECT provider_user_id FROM users WHERE id = $1',
    [userId]
  )

  if (!user?.provider_user_id) {
    throw new Error('User is not linked to media server')
  }

  const pairs = await getProviderIdPairs(movieIds, seriesIds)
  const providerUserId = user.provider_user_id

  for (let i = 0; i < pairs.length; i += STATUS_CONCURRENCY) {
    const batch = pairs.slice(i, i + STATUS_CONCURRENCY)
    const statuses = await Promise.all(
      batch.map(async (pair) => {
        try {
          return await provider.isItemFavorite(apiKey, providerUserId, pair.providerItemId)
        } catch (err) {
          // One unreadable item must not sink the whole list.
          logger.warn({ err, itemId: pair.providerItemId }, 'Favorite status lookup failed')
          return false
        }
      })
    )
    batch.forEach((pair, index) => {
      if (!statuses[index]) return
      if (pair.kind === 'movie') result.movieIds.push(pair.internalId)
      else result.seriesIds.push(pair.internalId)
    })
  }

  return result
}
