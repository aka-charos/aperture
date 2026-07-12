/**
 * Media server Person item metadata (biography, birth/death date, birthplace)
 * with a DB-backed cache keyed by normalized name.
 *
 * Fetched on demand from Emby/Jellyfin and refreshed on TTL so metadata edits
 * on the server flow through without a dedicated sync job. When the media
 * server is unreachable, a stale cache row is served rather than failing.
 */

import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getMediaServerProvider } from '../media/index.js'
import { getMediaServerApiKey } from '../settings/systemSettings.js'
import { normalizePersonNameKey } from '../tmdb/person.js'
import { findPersonMediaServerItemIdForName } from './personPortraitPush.js'

const logger = createChildLogger('person-media-server-details')

/** Refresh cached person metadata from the media server after 7 days. */
export const PERSON_MEDIA_SERVER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface PersonMediaServerDetails {
  itemId: string | null
  overview: string | null
  /** ISO date string */
  birthDate: string | null
  /** ISO date string */
  deathDate: string | null
  birthPlace: string | null
}

interface CacheRow {
  item_id: string | null
  overview: string | null
  birth_date: Date | null
  death_date: Date | null
  birth_place: string | null
  not_found: boolean
  updated_at: Date
}

function rowToDetails(row: CacheRow): PersonMediaServerDetails | null {
  if (row.not_found) {
    return null
  }
  return {
    itemId: row.item_id,
    overview: row.overview,
    birthDate: row.birth_date ? row.birth_date.toISOString() : null,
    deathDate: row.death_date ? row.death_date.toISOString() : null,
    birthPlace: row.birth_place,
  }
}

async function getCacheRow(nameKey: string): Promise<CacheRow | null> {
  return queryOne<CacheRow>(
    `SELECT item_id, overview, birth_date, death_date, birth_place, not_found, updated_at
     FROM person_media_server_cache WHERE name_key = $1`,
    [nameKey]
  )
}

async function upsertCacheRow(
  nameKey: string,
  details: PersonMediaServerDetails | null
): Promise<void> {
  await query(
    `INSERT INTO person_media_server_cache (
       name_key, item_id, overview, birth_date, death_date, birth_place, not_found, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (name_key) DO UPDATE SET
       item_id = EXCLUDED.item_id,
       overview = EXCLUDED.overview,
       birth_date = EXCLUDED.birth_date,
       death_date = EXCLUDED.death_date,
       birth_place = EXCLUDED.birth_place,
       not_found = EXCLUDED.not_found,
       updated_at = NOW()`,
    [
      nameKey,
      details?.itemId ?? null,
      details?.overview ?? null,
      details?.birthDate ?? null,
      details?.deathDate ?? null,
      details?.birthPlace ?? null,
      details == null,
    ]
  )
}

/**
 * Resolve person metadata from cache or the media server; upserts the cache row.
 * Returns null when the person has no Person item on the server (also cached).
 */
export async function getPersonMediaServerDetails(
  decodedName: string
): Promise<PersonMediaServerDetails | null> {
  const name = decodedName.trim()
  if (!name) {
    return null
  }
  const nameKey = normalizePersonNameKey(name)

  const cached = await getCacheRow(nameKey)
  if (cached && Date.now() - new Date(cached.updated_at).getTime() < PERSON_MEDIA_SERVER_CACHE_TTL_MS) {
    return rowToDetails(cached)
  }

  try {
    const provider = await getMediaServerProvider()
    const apiKey = await getMediaServerApiKey()
    if (!apiKey) {
      throw new Error('Media server API key is not configured')
    }

    const personId = (await findPersonMediaServerItemIdForName(name)) ?? undefined
    const person = await provider.getPersonDetails(apiKey, { name, personId })

    const details: PersonMediaServerDetails | null = person
      ? {
          itemId: person.id,
          overview: person.overview,
          birthDate: person.birthDate,
          deathDate: person.deathDate,
          birthPlace: person.birthPlace,
        }
      : null

    await upsertCacheRow(nameKey, details)
    return details
  } catch (err) {
    logger.warn(
      { err, name, hasStaleCache: !!cached },
      'Failed to fetch person details from media server; serving stale cache if available'
    )
    return cached ? rowToDetails(cached) : null
  }
}
