/**
 * Seerr search result -> Aperture search result.
 *
 * Split out from the source itself, and importing nothing at runtime, so the
 * mapping can be pinned by a test without dragging the core barrel (and its
 * database pool) into the test process. It is also the part most likely to
 * regress quietly: `tv` becoming `series`, and availability being read from
 * two status fields rather than one, are both invisible until a user is
 * offered a Request button for something they already have.
 */
import type { SeerrMediaInfo, SeerrSearchItem } from '@aperture/core'
import type { ContentAvailability, ContentSearchItem } from './types.js'

const AVAILABILITY_BY_CODE: Record<number, ContentAvailability> = {
  1: 'unknown',
  2: 'pending',
  3: 'processing',
  4: 'partially_available',
  5: 'available',
}

const REQUEST_STATUS_BY_CODE: Record<number, 'pending' | 'approved' | 'declined'> = {
  1: 'pending',
  2: 'approved',
  3: 'declined',
}

/**
 * Seerr may serialize a status as a number or a string depending on version
 * and JSON path, so normalize before comparing (same guard as the media
 * status reader in core's provider).
 */
function statusCode(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function yearFrom(date: string | undefined): number | null {
  if (!date) return null
  const year = Number.parseInt(date.slice(0, 4), 10)
  return Number.isFinite(year) ? year : null
}

/**
 * Availability reads HD and 4K together: a title present only in 4K is still
 * present, and the panel would otherwise offer a Request button for something
 * the user already has.
 */
function readAvailability(mediaInfo: SeerrMediaInfo | undefined): ContentAvailability {
  if (!mediaInfo) return 'unknown'
  const hd = statusCode(mediaInfo.status)
  const fourK = statusCode(mediaInfo.status4k)
  const best = Math.max(hd ?? 1, fourK ?? 1)
  return AVAILABILITY_BY_CODE[best] ?? 'unknown'
}

export function mapSeerrSearchItem(item: SeerrSearchItem): ContentSearchItem | null {
  const title = item.title ?? item.name
  if (!title) return null

  if (item.mediaType === 'person') {
    return {
      tmdbId: item.id,
      mediaType: 'person',
      title,
      year: null,
      overview: null,
      posterPath: null,
      backdropPath: null,
      profilePath: item.profilePath ?? null,
      voteAverage: null,
      availability: 'unknown',
      requested: false,
      requestStatus: null,
      knownFor: (item.knownFor ?? [])
        .map((k) => k.title ?? k.name)
        .filter((t): t is string => !!t)
        .slice(0, 3),
    }
  }

  const mediaInfo = item.mediaInfo
  const latestRequest = mediaInfo?.requests?.[0]
  const availability = readAvailability(mediaInfo)

  return {
    tmdbId: item.id,
    mediaType: item.mediaType === 'tv' ? 'series' : 'movie',
    title,
    year: yearFrom(item.releaseDate ?? item.firstAirDate),
    overview: item.overview ?? null,
    posterPath: item.posterPath ?? null,
    backdropPath: item.backdropPath ?? null,
    profilePath: null,
    voteAverage: item.voteAverage ?? null,
    availability,
    requested:
      Boolean(mediaInfo?.requests?.length) ||
      availability === 'pending' ||
      availability === 'processing',
    requestStatus: latestRequest ? REQUEST_STATUS_BY_CODE[latestRequest.status] ?? null : null,
    knownFor: [],
  }
}
