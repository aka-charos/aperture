/**
 * Jellyfin Persons Module
 *
 * Fetches Person item metadata (biography, birth/death date, birthplace).
 * By-id lookups use GET /Items/{id}; by-name uses GET /Persons?searchTerm=
 * with an exact-name match (avoids the 404 from GET /Persons/{name}).
 */

import type { PersonDetails } from '../types.js'
import type { JellyfinItem, JellyfinItemsResponse } from './types.js'
import { logger, type JellyfinProviderBase } from './base.js'

/** On Person items: PremiereDate = birth date, EndDate = death date, ProductionLocations[0] = birthplace. */
const PERSON_DETAIL_FIELDS = 'Overview,PremiereDate,EndDate,ProductionLocations,ProviderIds'

/** Person overviews can contain embedded HTML links; keep plain text. */
function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim()
}

function mapJellyfinItemToPersonDetails(item: JellyfinItem): PersonDetails {
  return {
    id: item.Id,
    name: item.Name,
    overview: item.Overview ? stripHtml(item.Overview) : null,
    birthDate: item.PremiereDate ?? null,
    deathDate: item.EndDate ?? null,
    birthPlace: item.ProductionLocations?.[0] ?? null,
  }
}

export async function getPersonDetails(
  provider: JellyfinProviderBase,
  apiKey: string,
  opts: { name: string; personId?: string }
): Promise<PersonDetails | null> {
  if (opts.personId) {
    try {
      const item = await provider.fetch<JellyfinItem>(
        `/Items/${opts.personId}?Fields=${PERSON_DETAIL_FIELDS}`,
        apiKey
      )
      if (item?.Id) {
        return mapJellyfinItemToPersonDetails(item)
      }
    } catch {
      logger.warn(
        { personId: opts.personId, name: opts.name },
        'Person item id from sync not found on Jellyfin; falling back to name search'
      )
    }
  }

  const params = new URLSearchParams({
    searchTerm: opts.name,
    fields: PERSON_DETAIL_FIELDS,
    limit: '20',
  })
  const response = await provider.fetch<JellyfinItemsResponse>(`/Persons?${params}`, apiKey)

  const wanted = opts.name.trim().toLowerCase()
  const match = response.Items?.find((item) => item.Name?.trim().toLowerCase() === wanted)
  if (!match) {
    logger.info(
      { name: opts.name, candidates: response.Items?.length ?? 0 },
      'No exact person name match on Jellyfin'
    )
    return null
  }

  return mapJellyfinItemToPersonDetails(match)
}
