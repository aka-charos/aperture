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

  logger.info({ userId, favorite, updated, skipped }, 'Updated user favorites')

  return { updated, skipped }
}
