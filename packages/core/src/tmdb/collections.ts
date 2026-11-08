/**
 * TMDb Collections/Franchises API Functions
 */

import { createChildLogger } from '../lib/logger.js'
import { tmdbLookup, tmdbRequest, getImageUrl, type ApiLogCallback, type TmdbLookup } from './client.js'
import type { TMDbCollectionDetails, CollectionData } from './types.js'

const logger = createChildLogger('tmdb:collections')

/**
 * Map TMDb collection API response to internal CollectionData (also used when hydrating from DB cache).
 */
export function collectionDetailsToCollectionData(details: TMDbCollectionDetails): CollectionData {
  return {
    tmdbId: details.id,
    name: details.name,
    overview: details.overview,
    posterUrl: getImageUrl(details.poster_path),
    posterPath: details.poster_path,
    backdropUrl: getImageUrl(details.backdrop_path, 'original'),
    backdropPath: details.backdrop_path ?? null,
    parts: details.parts.map((part) => ({
      tmdbId: part.id,
      title: part.title,
      releaseDate: part.release_date,
      posterPath: part.poster_path,
    })),
  }
}

/**
 * Get collection details from TMDb
 */
export async function getCollectionDetails(
  collectionId: number,
  options: { onLog?: ApiLogCallback } = {}
): Promise<TMDbCollectionDetails | null> {
  return tmdbRequest<TMDbCollectionDetails>(`/collection/${collectionId}`, options)
}

/**
 * Get collection data in our internal format
 */
export async function getCollectionData(
  collectionId: number,
  options: { onLog?: ApiLogCallback } = {}
): Promise<CollectionData | null> {
  const details = await getCollectionDetails(collectionId, options)
  if (!details) {
    logger.debug({ collectionId }, 'Could not fetch collection details from TMDb')
    return null
  }

  return collectionDetailsToCollectionData(details)
}

/** `getCollectionData` for a caller that must tell a failed request from a collection TMDb lacks. */
export async function lookupCollectionData(collectionId: number): Promise<TmdbLookup<CollectionData>> {
  const answer = await tmdbLookup<TMDbCollectionDetails>(`/collection/${collectionId}`)
  return answer.status === 'ok'
    ? { status: 'ok', data: collectionDetailsToCollectionData(answer.data) }
    : answer
}

/**
 * Get multiple collections in batch
 */
export async function getCollectionsData(
  collectionIds: number[],
  options: { onLog?: ApiLogCallback } = {}
): Promise<Map<number, CollectionData>> {
  const results = new Map<number, CollectionData>()

  // Process in chunks to avoid overwhelming the API
  const chunkSize = 10
  for (let i = 0; i < collectionIds.length; i += chunkSize) {
    const chunk = collectionIds.slice(i, i + chunkSize)
    const promises = chunk.map(async (id) => {
      const data = await getCollectionData(id, options)
      if (data) {
        results.set(id, data)
      }
    })
    await Promise.all(promises)
  }

  return results
}


