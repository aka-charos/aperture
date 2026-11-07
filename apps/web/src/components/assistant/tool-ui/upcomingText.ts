/**
 * How a getUpcomingEpisodes card words its dates. Pure: pinned by
 * upcomingText.test.ts, because the wording is where "expected" and "in your
 * library" could quietly become the same claim.
 */
import type { UpcomingInfo } from './types'

/** "S02E05": same form as the Watching page. */
export function episodeCode(season: number, number: number): string {
  return `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`
}

/**
 * A calendar day in the viewer's language. In UTC on both ends: `new Date` reads
 * `YYYY-MM-DD` as UTC midnight, which a local format shows as the day before
 * anywhere west of it. An unreadable date is shown as sent.
 */
export function formatAirDay(day: string, locale: string): string {
  const parsed = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return day
  return parsed.toLocaleDateString(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export type UpcomingNextKey = 'upcomingExpected' | 'upcomingPastDue'
export type UpcomingLatestKey =
  | 'upcomingLatestInLibrary'
  | 'upcomingLatestUnplayed'
  | 'upcomingLatestNotInLibrary'

export function nextDateKey(next: UpcomingInfo['next']): UpcomingNextKey {
  return next.status === 'pastDue' ? 'upcomingPastDue' : 'upcomingExpected'
}

export function latestAiredKey(latest: NonNullable<UpcomingInfo['latestAired']>): UpcomingLatestKey {
  if (!latest.inLibrary) return 'upcomingLatestNotInLibrary'
  return latest.played ? 'upcomingLatestInLibrary' : 'upcomingLatestUnplayed'
}
