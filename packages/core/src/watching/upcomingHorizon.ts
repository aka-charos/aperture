/**
 * How far ahead an episode still counts as "upcoming" on the Watching page
 * and the dashboard row.
 *
 * TMDb's next_episode_to_air is often a season premiere announced most of a
 * year out, and showing it beside next week's episodes reads as noise. This is
 * a DISPLAY rule only: the aired-episode count still needs the real next
 * episode (it caps the current season at "next episode − 1"), so callers keep
 * the full lookup for that and apply this when deciding what to show.
 *
 * Pure, no DB: pinned by upcomingHorizon.test.ts.
 */

export const UPCOMING_EPISODE_HORIZON_MONTHS = 2

/** Last calendar day (UTC, `YYYY-MM-DD`) an episode may air on and still be shown. */
export function upcomingHorizonDate(now: Date = new Date()): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + UPCOMING_EPISODE_HORIZON_MONTHS
  const d = now.getUTCDate()
  // Clamp to the target month's last day, so 31 Dec + 2 months is 28/29 Feb,
  // not 3 Mar (Date.UTC would roll the overflow into the next month).
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(d, lastDay))).toISOString().slice(0, 10)
}

/**
 * Whether an air date falls inside the horizon. An unparseable date is kept
 * rather than hidden: dropping an episode over a format we failed to read is
 * the worse mistake.
 */
export function isWithinUpcomingHorizon(
  airDate: string | Date,
  now: Date = new Date()
): boolean {
  const parsed = airDate instanceof Date ? airDate : new Date(airDate)
  if (Number.isNaN(parsed.getTime())) return true
  return parsed.toISOString().slice(0, 10) <= upcomingHorizonDate(now)
}
