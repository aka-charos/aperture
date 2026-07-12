/**
 * Emby user favorites (series) — FavoriteItems API
 */

import type { EmbyProviderBase } from './base.js'
import { logger } from './base.js'
import { isEmbyNotFoundError } from './fetchHelpers.js'

interface EmbyItemsIdResponse {
  Items: { Id: string }[]
  TotalRecordCount: number
}

/**
 * Paginated list of favorited series item ids for a user.
 */
export async function getFavoriteSeriesIdsForUser(
  provider: EmbyProviderBase,
  apiKey: string,
  userId: string
): Promise<string[]> {
  const ids: string[] = []
  let startIndex = 0
  const pageSize = 500

  while (true) {
    const params = new URLSearchParams({
      IncludeItemTypes: 'Series',
      Recursive: 'true',
      Fields: 'Id',
      IsFavorite: 'true',
      UserId: userId,
      StartIndex: String(startIndex),
      Limit: String(pageSize),
    })

    const response = await provider.fetch<EmbyItemsIdResponse>(
      `/Users/${userId}/Items?${params}`,
      apiKey
    )

    for (const item of response.Items) {
      ids.push(item.Id)
    }

    if (response.Items.length === 0 || startIndex + response.Items.length >= response.TotalRecordCount) {
      break
    }
    startIndex += response.Items.length
  }

  logger.debug({ userId, count: ids.length }, 'Fetched Emby favorite series ids')
  return ids
}

/**
 * Mark any item (movie, series, episode, …) as favorite for a user.
 * The FavoriteItems endpoint is type-agnostic — it only needs the item id.
 */
export async function favoriteItem(
  provider: EmbyProviderBase,
  apiKey: string,
  userId: string,
  itemId: string
): Promise<void> {
  const path = `/Users/${encodeURIComponent(userId)}/FavoriteItems/${encodeURIComponent(itemId)}`
  await provider.fetch(path, apiKey, { method: 'POST' })
}

/**
 * Remove favorite from any item for a user. Idempotent: 404 means already not a favorite.
 */
export async function unfavoriteItem(
  provider: EmbyProviderBase,
  apiKey: string,
  userId: string,
  itemId: string
): Promise<void> {
  const path = `/Users/${encodeURIComponent(userId)}/FavoriteItems/${encodeURIComponent(itemId)}`
  try {
    await provider.fetch(path, apiKey, { method: 'DELETE' })
  } catch (err) {
    if (isEmbyNotFoundError(err)) {
      logger.debug({ userId, itemId }, 'Unfavorite noop (already not favorite)')
      return
    }
    throw err
  }
}

/**
 * Whether an item is currently favorited by a user. Unknown items report false.
 */
export async function isItemFavorite(
  provider: EmbyProviderBase,
  apiKey: string,
  userId: string,
  itemId: string
): Promise<boolean> {
  const path = `/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}`
  try {
    const item = await provider.fetch<{ UserData?: { IsFavorite?: boolean } }>(path, apiKey)
    return item.UserData?.IsFavorite === true
  } catch (err) {
    if (isEmbyNotFoundError(err)) {
      return false
    }
    throw err
  }
}

// Series favorites use the same endpoint — kept as named aliases for existing call sites.
export const favoriteSeriesItem = favoriteItem
export const unfavoriteSeriesItem = unfavoriteItem
