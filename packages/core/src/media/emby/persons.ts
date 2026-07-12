/**
 * Emby Persons Module
 *
 * Fetches Person item metadata (biography, birth/death date, birthplace).
 * Emby has no GET /Persons/{Name} route; resolution goes through
 * GET /Persons with Ids= (when the item id is known from synced cast data)
 * or SearchTerm= with an exact-name match on the results.
 */

import type { PersonDetails } from '../types.js'
import type { EmbyItem, EmbyItemsResponse } from './types.js'
import { logger, type EmbyProviderBase } from './base.js'

/** On Person items: PremiereDate = birth date, EndDate = death date, ProductionLocations[0] = birthplace. */
const PERSON_DETAIL_FIELDS = 'Overview,PremiereDate,EndDate,ProductionLocations,ProviderIds'

/** Emby person overviews can contain embedded HTML links; keep plain text. */
function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim()
}

function mapEmbyItemToPersonDetails(item: EmbyItem): PersonDetails {
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
  provider: EmbyProviderBase,
  apiKey: string,
  opts: { name: string; personId?: string }
): Promise<PersonDetails | null> {
  if (opts.personId) {
    const byId = await provider.fetch<EmbyItemsResponse>(
      `/Persons?Ids=${encodeURIComponent(opts.personId)}&Fields=${PERSON_DETAIL_FIELDS}`,
      apiKey
    )
    if (byId.Items?.length) {
      return mapEmbyItemToPersonDetails(byId.Items[0])
    }
    logger.warn(
      { personId: opts.personId, name: opts.name },
      'Person item id from sync not found on Emby; falling back to name search'
    )
  }

  const params = new URLSearchParams({
    SearchTerm: opts.name,
    Fields: PERSON_DETAIL_FIELDS,
    Limit: '20',
  })
  const response = await provider.fetch<EmbyItemsResponse>(`/Persons?${params}`, apiKey)

  const wanted = opts.name.trim().toLowerCase()
  const match = response.Items?.find((item) => item.Name?.trim().toLowerCase() === wanted)
  if (!match) {
    logger.info({ name: opts.name, candidates: response.Items?.length ?? 0 }, 'No exact person name match on Emby')
    return null
  }

  return mapEmbyItemToPersonDetails(match)
}
