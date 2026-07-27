/**
 * Emby Collections (Box Sets) Module
 */

import type { CollectionCreateResult } from '../types.js'
import type { EmbyItemsResponse } from './types.js'
import type { EmbyProviderBase } from './base.js'
import { setForcedSortName, updateEmbyItemSafely } from './itemUpdates.js'
import {
  buildCollectionCreateParams,
  buildItemSearchParams,
  collectionChildItemsQuery,
  collectionItemsPath,
} from './requestBuilders.js'

export async function createOrUpdateCollection(
  provider: EmbyProviderBase,
  apiKey: string,
  name: string,
  itemIds: string[],
  opts?: { rankAndPin?: boolean; overview?: string }
): Promise<CollectionCreateResult> {
  // Showcase ordering — pinning the collection to the top of the library and rewriting each
  // member's global sort name to "NN - Title" — is intentional for the Top Picks collection but
  // undesirable for arbitrary user collections, which opt out with rankAndPin: false.
  const rankAndPin = opts?.rankAndPin !== false

  const params = buildItemSearchParams({
    includeItemTypes: 'BoxSet',
    searchTerm: name,
  })

  const existing = await provider.fetch<EmbyItemsResponse>(`/Items?${params}`, apiKey)
  const collection = existing.Items.find((c) => c.Name === name)

  let collectionId: string

  if (collection) {
    collectionId = collection.Id

    const existingItems = await provider.fetch<EmbyItemsResponse>(
      collectionChildItemsQuery(collection.Id),
      apiKey
    )

    if (existingItems.Items && existingItems.Items.length > 0) {
      const existingIds = existingItems.Items.map((item) => item.Id)
      await provider.fetch(collectionItemsPath(collection.Id, existingIds), apiKey, {
        method: 'DELETE',
      })
    }

    if (itemIds.length > 0) {
      await provider.fetch(collectionItemsPath(collection.Id, itemIds), apiKey, {
        method: 'POST',
      })
    }
  } else {
    const createParams = buildCollectionCreateParams(name, itemIds)

    const created = await provider.fetch<{ Id: string }>(`/Collections?${createParams}`, apiKey, {
      method: 'POST',
    })

    collectionId = created.Id

    if (rankAndPin) {
      await setCollectionSortTitle(provider, apiKey, collectionId, name)
    }
  }

  if (rankAndPin) {
    await setItemRankSortNames(provider, apiKey, itemIds)
  }

  // Applied on both branches: editing a collection's description should reach the library, not
  // just the row that created it. The Collections endpoint takes no Overview, so it is a separate
  // item update either way.
  if (opts?.overview) {
    await updateCollectionOverview(provider, apiKey, collectionId, opts.overview)
  }

  return { collectionId }
}

/**
 * Write a collection's description into the Box Set's Overview.
 *
 * Collections are server-wide, so unlike a playlist this needs no user context — `/Items/{id}`
 * is both the fetch and the post path. Non-fatal: a collection with a stale description is far
 * better than a failed generate.
 */
export async function updateCollectionOverview(
  provider: EmbyProviderBase,
  apiKey: string,
  collectionId: string,
  overview: string
): Promise<void> {
  await updateEmbyItemSafely(
    provider,
    apiKey,
    `/Items/${collectionId}`,
    (item) => {
      item.Overview = overview
    },
    { collectionId, operation: 'updateCollectionOverview' }
  )
}

export async function deleteCollection(
  provider: EmbyProviderBase,
  apiKey: string,
  collectionId: string
): Promise<void> {
  await provider.fetch(`/Items/${collectionId}`, apiKey, { method: 'DELETE' })
}

export async function getCollectionItems(
  provider: EmbyProviderBase,
  apiKey: string,
  collectionId: string
): Promise<string[]> {
  const response = await provider.fetch<EmbyItemsResponse>(
    collectionChildItemsQuery(collectionId),
    apiKey
  )

  return response.Items.map((item) => item.Id)
}

export async function addCollectionItems(
  provider: EmbyProviderBase,
  apiKey: string,
  collectionId: string,
  itemIds: string[]
): Promise<void> {
  if (itemIds.length === 0) return
  await provider.fetch(collectionItemsPath(collectionId, itemIds), apiKey, {
    method: 'POST',
  })
}

export async function removeCollectionItems(
  provider: EmbyProviderBase,
  apiKey: string,
  collectionId: string,
  itemIds: string[]
): Promise<void> {
  if (itemIds.length === 0) return
  await provider.fetch(collectionItemsPath(collectionId, itemIds), apiKey, {
    method: 'DELETE',
  })
}

export async function findCollectionByName(
  provider: EmbyProviderBase,
  apiKey: string,
  name: string
): Promise<string | null> {
  const params = buildItemSearchParams({
    includeItemTypes: 'BoxSet',
    searchTerm: name,
  })

  const response = await provider.fetch<EmbyItemsResponse>(`/Items?${params}`, apiKey)
  const collection = response.Items.find((c) => c.Name === name)

  return collection?.Id ?? null
}

async function setCollectionSortTitle(
  provider: EmbyProviderBase,
  apiKey: string,
  collectionId: string,
  name: string
): Promise<void> {
  const sortTitle = `!!!!!!${name}`

  await updateEmbyItemSafely(
    provider,
    apiKey,
    `/Items/${collectionId}`,
    (item) => {
      setForcedSortName(item, sortTitle, false)
      item.LockedFields = ['SortName']
    },
    { collectionId, operation: 'setCollectionSortTitle' }
  )
}

async function setItemRankSortNames(
  provider: EmbyProviderBase,
  apiKey: string,
  itemIds: string[]
): Promise<void> {
  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i]
    const rankPrefix = String(i + 1).padStart(2, '0')

    await updateEmbyItemSafely(
      provider,
      apiKey,
      `/Items/${itemId}`,
      (item) => {
        const originalName = item.Name || 'Unknown'
        setForcedSortName(item, `${rankPrefix} - ${originalName}`)
      },
      { itemId, operation: 'setItemRankSortName' }
    )
  }
}
