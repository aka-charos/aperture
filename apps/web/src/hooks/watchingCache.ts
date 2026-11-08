/**
 * The "Shows You Watch" cache: one slot per browser, holding one person's list.
 *
 * A browser can change hands. The list carries its owner's id and only that person
 * gets it back, so the next account at this browser cannot be shown someone else's
 * shows: a hit skips the fetch, so nothing would have corrected them for up to a
 * day. Older entries have no owner and read as a miss.
 *
 * Pure, so the rules can be tested without a browser.
 */

export const WATCHING_CACHE_TTL_MS = 24 * 60 * 60 * 1000

// v6: adds recentlyAiredEpisode (v5 episodesAired/episodesMissing, v4
// normalized status, v2 the union)
export const WATCHING_CACHE_VERSION = 6

interface CachedWatching<T> {
  series: T[]
  timestamp: number
  version: number
  userId?: string
}

export function serializeWatchingCache<T>(series: T[], userId: string, now: number): string {
  const data: CachedWatching<T> = { series, timestamp: now, version: WATCHING_CACHE_VERSION, userId }
  return JSON.stringify(data)
}

/** The list, if this slot holds a current one belonging to `userId`. */
export function readWatchingCache<T>(raw: string | null, userId: string | null, now: number): T[] | null {
  if (!raw || !userId) return null
  let data: CachedWatching<T>
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (data?.version !== WATCHING_CACHE_VERSION || data.userId !== userId) return null
  if (now - data.timestamp > WATCHING_CACHE_TTL_MS) return null
  return Array.isArray(data.series) ? data.series : null
}
