/**
 * The two date windows behind the dashboard's episode row: how far AHEAD an
 * episode still counts as upcoming, and how far BACK a show's latest episode
 * still counts as recently aired.
 *
 * TMDb's next_episode_to_air is often a season premiere announced most of a
 * year out, and showing it beside next week's episodes reads as noise. The
 * upcoming horizon is a DISPLAY rule only: the aired-episode count still needs
 * the real next episode (it caps the current season at "next episode − 1"), so
 * callers keep the full lookup for that and apply this when deciding what to
 * show.
 *
 * Recently aired covers the show with nothing scheduled soon whose latest
 * episodes just came out: a season released all at once, or a weekly season
 * that just finished.
 *
 * Pure, no DB: pinned by episodeWindows.test.ts.
 */

export const UPCOMING_EPISODE_HORIZON_MONTHS = 2
export const RECENTLY_AIRED_WINDOW_MONTHS = 2

/**
 * `now` moved by whole calendar months, as a UTC `YYYY-MM-DD`. Clamps to the
 * target month's last day, so 31 Dec + 2 months is 28/29 Feb, not 3 Mar
 * (Date.UTC would roll the overflow into the next month).
 */
function shiftMonths(now: Date, months: number): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(now.getUTCDate(), lastDay))).toISOString().slice(0, 10)
}

/** Last calendar day (UTC, `YYYY-MM-DD`) an episode may air on and still be shown. */
export function upcomingHorizonDate(now: Date = new Date()): string {
  return shiftMonths(now, UPCOMING_EPISODE_HORIZON_MONTHS)
}

/** First calendar day (UTC, `YYYY-MM-DD`) a latest episode may have aired on and still count as recent. */
export function recentlyAiredSinceDate(now: Date = new Date()): string {
  return shiftMonths(now, -RECENTLY_AIRED_WINDOW_MONTHS)
}

/** `YYYY-MM-DD` of an air date, or null when it cannot be read. */
function toDay(airDate: string | Date): string | null {
  const parsed = airDate instanceof Date ? airDate : new Date(airDate)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

/**
 * Whether an air date falls on or before `horizon` (from `upcomingHorizonDate`,
 * computed once per request rather than per series). An unparseable date is
 * kept rather than hidden: dropping an episode over a format we failed to read
 * is the worse mistake.
 */
export function isWithinUpcomingHorizon(airDate: string | Date, horizon: string): boolean {
  const day = toDay(airDate)
  return day === null || day <= horizon
}

/**
 * Whether an episode aired between `since` (from `recentlyAiredSinceDate`) and
 * `today`, both inclusive. An unparseable date is NOT recent: this adds a show
 * to a list, and a date we cannot read is no reason to add one.
 */
export function isRecentlyAired(airDate: string | Date, since: string, today: string): boolean {
  const day = toDay(airDate)
  return day !== null && day >= since && day <= today
}

/** One season of one show, as the server holds it and as far as this viewer played it. */
export interface SeasonProgress {
  /** Highest episode number of the season on the server */
  serverLastEpisode: number | null
  /** Highest episode number of the season this viewer played, null when none */
  playedLastEpisode: number | null
}

/**
 * Whether a show's recently aired episode is news to THIS viewer: they were
 * caught up when it came out. A show someone sampled once years ago must not
 * come back on the strength of a new season they are three seasons behind.
 *
 * - They played anything in the latest episode's season or later: they are in
 *   it, so a just-finished season or a season dropped all at once counts.
 * - The latest episode is in season 1 and they played nothing: nothing came
 *   before it, so only the watchlist can have put the show here, and a show
 *   added to wait for its premiere is exactly the one to show.
 * - Otherwise they must have played the last episode the SERVER holds of the
 *   previous season: finished S3, S4 just aired → yes; stopped in S1 → no.
 *   A previous season missing from the server cannot have been finished here.
 */
export function wasCaughtUp(
  latestSeason: number,
  seasons: ReadonlyMap<number, SeasonProgress> | undefined
): boolean {
  if (seasons) {
    for (const [season, progress] of seasons) {
      if (season >= latestSeason && progress.playedLastEpisode != null) return true
    }
  }
  if (latestSeason <= 1) return true
  const previous = seasons?.get(latestSeason - 1)
  if (!previous || previous.playedLastEpisode == null) return false
  return previous.serverLastEpisode == null || previous.playedLastEpisode >= previous.serverLastEpisode
}

export interface AiredEpisode {
  seasonNumber: number
  episodeNumber: number
  title: string
  airDate: string // YYYY-MM-DD
  source: 'emby' | 'tmdb'
}

/**
 * The later of the media server's and TMDb's latest aired episode. TMDb knows
 * seasons the server has not picked up; the server is fresher between TMDb
 * refreshes. On the same day the later episode number wins, and on a full tie
 * the server's copy, since that is the one the viewer can play.
 */
export function pickLatestAired(
  emby: AiredEpisode | null,
  tmdb: AiredEpisode | null
): AiredEpisode | null {
  if (!emby) return tmdb
  if (!tmdb) return emby
  if (emby.airDate !== tmdb.airDate) return emby.airDate > tmdb.airDate ? emby : tmdb
  if (emby.seasonNumber !== tmdb.seasonNumber) {
    return emby.seasonNumber > tmdb.seasonNumber ? emby : tmdb
  }
  return tmdb.episodeNumber > emby.episodeNumber ? tmdb : emby
}
