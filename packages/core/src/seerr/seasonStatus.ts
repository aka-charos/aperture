/**
 * A show's standing in Seerr, season by season.
 *
 * Seerr's `/tv/:id` carries it in two places: `mediaInfo.seasons` (what Sonarr and
 * the library scan have reported) and `mediaInfo.requests[].seasons` (what people
 * asked for). A request can exist before any season row moves, so both count.
 *
 * The numbers are Seerr's. Media: 1 unknown, 2 pending, 3 processing, 4 partly
 * available, 5 available, 6 blocklisted, 7 deleted. Request: 1 pending, 2 approved,
 * 3 declined, 4 failed, 5 completed. A declined or completed request no longer holds
 * its seasons in Seerr; a failed one still does, so it is left counted here.
 *
 * Pure, with no runtime imports. Like the movie side, HD and 4K are read together:
 * a title in either is in Seerr.
 */

import type { SeerrStatus } from '../tmdb/collectionParts.js'
import type { SeerrMediaInfo } from './types.js'

const RELEASED_REQUEST_STATUSES = new Set<number>([3, 5])

function fromMediaStatus(status: number | null | undefined): SeerrStatus {
  const code = Number(status)
  if (code === 4 || code === 5) return 'available'
  if (code === 3) return 'processing'
  if (code === 2) return 'requested'
  return 'none'
}

const RANK: Record<SeerrStatus, number> = { none: 0, requested: 1, processing: 2, available: 3 }

function stronger(a: SeerrStatus, b: SeerrStatus): SeerrStatus {
  return RANK[a] >= RANK[b] ? a : b
}

/** Only seasons Seerr says something about; one it does not mention reads as `none`. */
export function seerrSeasonStatuses(mediaInfo: SeerrMediaInfo | null | undefined): Map<number, SeerrStatus> {
  const statuses = new Map<number, SeerrStatus>()
  if (!mediaInfo) return statuses

  const note = (seasonNumber: number, status: SeerrStatus) => {
    if (status === 'none') return
    statuses.set(seasonNumber, stronger(statuses.get(seasonNumber) ?? 'none', status))
  }

  for (const season of mediaInfo.seasons ?? []) {
    note(season.seasonNumber, fromMediaStatus(season.status))
    note(season.seasonNumber, fromMediaStatus(season.status4k))
  }
  for (const request of mediaInfo.requests ?? []) {
    if (RELEASED_REQUEST_STATUSES.has(Number(request.status))) continue
    for (const season of request.seasons ?? []) note(season.seasonNumber, 'requested')
  }
  return statuses
}
