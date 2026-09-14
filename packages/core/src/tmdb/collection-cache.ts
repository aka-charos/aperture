/**
 * Persisted TMDb collection metadata + parts for gap analysis and other features.
 * Gap analysis run populates this; admin gap UI reads summaries from cache only (no N API calls).
 */

import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getImageUrl, type ApiLogCallback } from './client.js'
import { getCollectionData } from './collections.js'
import type { CollectionData } from './types.js'

type CachedPart = {
  tmdbId: number
  title: string
  releaseDate: string | null
  posterPath: string | null
}

function rowToCollectionData(row: {
  collection_id: number
  name: string
  overview: string | null
  poster_path: string | null
  backdrop_path: string | null
  parts_json: unknown
}): CollectionData {
  const raw = row.parts_json
  const partsArr = Array.isArray(raw) ? raw : []
  const parts: CollectionData['parts'] = partsArr.map((p: CachedPart) => ({
    tmdbId: Number(p.tmdbId),
    title: String(p.title),
    releaseDate: p.releaseDate ?? null,
    posterPath: p.posterPath ?? null,
  }))
  return {
    tmdbId: row.collection_id,
    name: row.name,
    overview: row.overview,
    posterUrl: getImageUrl(row.poster_path),
    posterPath: row.poster_path,
    backdropUrl: getImageUrl(row.backdrop_path, 'original'),
    backdropPath: row.backdrop_path,
    parts,
  }
}

/**
 * Upsert full collection payload after a successful TMDb fetch.
 */
export async function upsertCollectionCache(data: CollectionData): Promise<void> {
  const parts: CachedPart[] = data.parts.map((p) => ({
    tmdbId: p.tmdbId,
    title: p.title,
    releaseDate: p.releaseDate,
    posterPath: p.posterPath,
  }))
  await query(
    `INSERT INTO tmdb_collection_cache (
       collection_id, name, overview, poster_path, backdrop_path, parts_json, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
     ON CONFLICT (collection_id) DO UPDATE SET
       name = EXCLUDED.name,
       overview = EXCLUDED.overview,
       poster_path = EXCLUDED.poster_path,
       backdrop_path = EXCLUDED.backdrop_path,
       parts_json = EXCLUDED.parts_json,
       updated_at = NOW()`,
    [
      data.tmdbId,
      data.name,
      data.overview,
      data.posterPath,
      data.backdropPath ?? null,
      JSON.stringify(parts),
    ]
  )
}

/**
 * Load many collections from cache in one query (gap analysis summaries).
 */
export async function getCachedCollectionDataBatch(
  collectionIds: number[]
): Promise<Map<number, CollectionData>> {
  const out = new Map<number, CollectionData>()
  if (collectionIds.length === 0) return out

  const result = await query<{
    collection_id: number
    name: string
    overview: string | null
    poster_path: string | null
    backdrop_path: string | null
    parts_json: unknown
  }>(
    `SELECT collection_id, name, overview, poster_path, backdrop_path, parts_json
     FROM tmdb_collection_cache
     WHERE collection_id = ANY($1::int[])`,
    [collectionIds]
  )
  for (const row of result.rows) {
    out.set(row.collection_id, rowToCollectionData(row))
  }
  return out
}

const logger = createChildLogger('tmdb:collection-cache')

/**
 * How long a cached part list is trusted before TMDb is asked again.
 *
 * A collection changes when a sequel is announced, which is rare; a week keeps
 * a page view from spending a TMDb call while still picking one up. Gap
 * analysis and enrichment both refresh the cache on their own schedule too.
 */
export const COLLECTION_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * One collection for display: the cache when fresh, TMDb when not, and the
 * stale row when TMDb cannot answer.
 *
 * A stale list beats no list — an unconfigured key or an outage should cost the
 * newest sequel, not the whole page. Null only when there is neither.
 */
export async function getCollectionDataCached(
  collectionId: number,
  options: { maxAgeMs?: number } = {}
): Promise<CollectionData | null> {
  const maxAgeMs = options.maxAgeMs ?? COLLECTION_CACHE_MAX_AGE_MS
  const row = await queryOne<{
    collection_id: number
    name: string
    overview: string | null
    poster_path: string | null
    backdrop_path: string | null
    parts_json: unknown
    updated_at: Date
  }>(
    `SELECT collection_id, name, overview, poster_path, backdrop_path, parts_json, updated_at
     FROM tmdb_collection_cache
     WHERE collection_id = $1`,
    [collectionId]
  )

  if (row && Date.now() - new Date(row.updated_at).getTime() < maxAgeMs) {
    return rowToCollectionData(row)
  }

  try {
    const fresh = await fetchCollectionDataAndCache(collectionId)
    if (fresh) return fresh
  } catch (err) {
    logger.warn({ err, collectionId }, 'TMDb collection refresh failed; using cached copy if any')
  }
  return row ? rowToCollectionData(row) : null
}

/**
 * Fetch from TMDb and persist to cache (gap analysis pipeline).
 */
export async function fetchCollectionDataAndCache(
  collectionId: number,
  options: { onLog?: ApiLogCallback } = {}
): Promise<CollectionData | null> {
  const data = await getCollectionData(collectionId, options)
  if (data) {
    await upsertCollectionCache(data)
  }
  return data
}
