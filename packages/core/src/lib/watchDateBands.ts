/**
 * "When did you watch this?" — the coarse date ladder offered after someone
 * rates a title the media server says they have never played.
 *
 * Asking for an exact date would be absurd: nobody remembers that a film was
 * a Tuesday in March. Asking for nothing is worse, because the date we would
 * invent instead (now) is the single most damaging value available — see the
 * recency notes below. So the ladder trades precision for an answer people can
 * actually give, and this module is the one place that decides what a band
 * means.
 *
 * Three measurements shape it, and none of them are guesses:
 *
 * 1. The taste profile's recency weight is `max(0.25, 0.5 ** (days / 180))`
 *    (`taste-profile/builder.ts`), which reaches its floor at exactly 360 days.
 *    **Beyond a year, every date produces an identical weight** — the algorithm
 *    cannot tell 2019 from 2003. That is why the oldest band needs no precision
 *    at all and why it is a single bucket rather than a year picker.
 * 2. `getWatchHistory` orders `is_favorite DESC, play_count DESC,
 *    last_played_at DESC` and takes ~50 rows. A backfilled title has
 *    `play_count = 1`, so it lands in the mass where recency is the tiebreak,
 *    and stamping it *now* evicts a genuinely recent watch from the set that
 *    builds the taste vector. Hence: never default to now.
 * 3. `watch_history` is one row per title, so this date is also what the Watch
 *    Stats timeline, the busiest-day chart and the 30-day dashboard tile all
 *    read.
 *
 * Everything here is pure and pinned by `watchDateBands.test.ts`. The band
 * arithmetic has four ways to be subtly wrong (year boundaries, the clamp, the
 * empty-band drop, a midpoint landing in the future) and not one of them would
 * be visible in production.
 */

/**
 * The ladder, newest first. Ids travel to the client, which renders them
 * through `mediaDetail.watchDate.bands.*` — the web bundle never imports core,
 * so the API ships the *decided* list of bands and the client only translates.
 */
export const WATCH_DATE_BANDS = [
  'thisMonth',
  'lastMonth',
  'earlierThisYear',
  'lastYear',
  'longerAgo',
] as const

export type WatchDateBand = (typeof WATCH_DATE_BANDS)[number]

export function isWatchDateBand(value: unknown): value is WatchDateBand {
  return typeof value === 'string' && (WATCH_DATE_BANDS as readonly string[]).includes(value)
}

/**
 * The hour every approximate date is written at.
 *
 * Midday, for two independent reasons. Emby's `DatePlayed` is
 * `yyyyMMddHHmmss` with **no timezone**, and nothing in its documentation says
 * whether a bare stamp is read as UTC or as server-local — at noon a ±12h
 * misreading still lands on the intended day, where midnight would shift the
 * date. And it keeps fabricated watches out of the small hours of the activity
 * heatmap, where they would read as a real viewing habit.
 */
const APPROXIMATE_HOUR = 12

/** Local midnight on the first day of `date`'s month. */
function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** Local midnight on the first day of `date`'s year. */
function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1)
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** A half-open-free interval: both ends are days that count as inside it. */
interface BandRange {
  /** Earliest day the band covers, or null when the band is open below. */
  start: Date | null
  /** Latest day the band covers. */
  end: Date
}

/**
 * The raw calendar meaning of each band, before any clamp.
 *
 * The bands must not overlap, or the same day would be reachable by two
 * answers and the midpoints would disagree about what the user said. So
 * "earlier this year" ends the day before last month begins, and "longer ago"
 * is everything before last year.
 */
function bandRange(band: WatchDateBand, now: Date): BandRange {
  const thisMonthStart = startOfMonth(now)
  const lastMonthStart = addMonths(thisMonthStart, -1)

  switch (band) {
    case 'thisMonth':
      return { start: thisMonthStart, end: now }
    case 'lastMonth':
      return { start: lastMonthStart, end: addDays(thisMonthStart, -1) }
    case 'earlierThisYear':
      return { start: startOfYear(now), end: addDays(lastMonthStart, -1) }
    case 'lastYear': {
      const lastYear = now.getFullYear() - 1
      return { start: new Date(lastYear, 0, 1), end: new Date(lastYear, 11, 31) }
    }
    case 'longerAgo':
      // Open below: this is the bucket for everything the recency weight can no
      // longer distinguish.
      return { start: null, end: new Date(now.getFullYear() - 2, 11, 31) }
  }
}

/** Strip a Date to local midnight so comparisons are day-wise. */
function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Which bands a viewer could truthfully pick for this title.
 *
 * The release date clamps the ladder **from below only** — a 1998 film can
 * absolutely have been watched this month, so an old title keeps every band,
 * and it is new titles that lose options because there is no time down there
 * for them to have been watched in. A band survives if any part of it falls on
 * or after release.
 *
 * `premiere` null means the library knows no release date (4 titles in 12,608
 * on the reference instance), and then nothing is ruled out. Erring permissive
 * is deliberate: offering a band that turns out impossible costs a shrug,
 * hiding one that was real leaves the viewer with no way to say what happened.
 *
 * Returns newest-first, and can return an empty array — a title whose release
 * date is in the future has no band at all, and the caller must not prompt.
 */
export function availableWatchDateBands(now: Date, premiere: Date | null): WatchDateBand[] {
  const floor = premiere ? atMidnight(premiere) : null
  const today = atMidnight(now)

  return WATCH_DATE_BANDS.filter((band) => {
    const range = bandRange(band, now)
    const end = atMidnight(range.end)
    // Nothing can have been watched before it was released, or in the future.
    if (floor && end < floor) return false
    if (end > today) return false
    return true
  })
}

/**
 * The timestamp written for a chosen band.
 *
 * The **midpoint** of the band, clamped below by the release date, at midday.
 * A midpoint rather than either edge because the error is then symmetric and
 * bounded by half the band; picking an edge is systematically wrong in one
 * direction. The clamp is what makes "earlier this year" honest for a film
 * released in July — that band starts in July for it, not in January, so the
 * same answer writes different dates for different titles. That is correct.
 *
 * `longerAgo` has no lower edge, so there is no midpoint to take: it writes
 * 1 January of two years ago, which is always at least 366 days back and
 * therefore lands past the recency floor where every older date weighs the
 * same. It is a placeholder and reads like one, which `now - 400 days` would
 * not.
 *
 * Returns null when the band is not available for this title, so a caller
 * cannot write a date the viewer could not have meant.
 */
export function resolveWatchDate(
  band: WatchDateBand,
  now: Date,
  premiere: Date | null
): Date | null {
  if (!availableWatchDateBands(now, premiere).includes(band)) return null

  const range = bandRange(band, now)
  const floor = premiere ? atMidnight(premiere) : null

  // `longerAgo` is open below, and it is the one band with nothing to
  // interpolate: the viewer said only that it was a long time ago. Taking a
  // midpoint back to the release date would answer 2011 for a 1998 film, which
  // is a considered-looking estimate of something nobody stated. Write the
  // placeholder instead — always past the 360-day floor, where the recency
  // weight cannot tell one old date from another anyway.
  if (band === 'longerAgo') {
    const placeholder = new Date(now.getFullYear() - 2, 0, 1, APPROXIMATE_HOUR)
    if (floor && atMidnight(placeholder) < floor) {
      return new Date(floor.getFullYear(), floor.getMonth(), floor.getDate(), APPROXIMATE_HOUR)
    }
    return placeholder
  }

  const end = atMidnight(range.end)
  let start = atMidnight(range.start!)
  if (floor && start < floor) start = floor
  const anchor = start

  // Step whole days rather than halving a millisecond span. Both ends are
  // local midnights, so a span crossing a DST change is not a whole number of
  // 24h periods — halving the milliseconds lands at 23:30 on the previous day
  // in half the world's timezones, and the answer would depend on where the
  // server is. `setDate` is DST-safe; the rounded day count is not, but the
  // error there is under an hour against a day, so it cannot round wrong.
  const spanDays = Math.round((end.getTime() - anchor.getTime()) / 86_400_000)
  const midpoint = addDays(anchor, Math.floor(spanDays / 2))

  const resolved = new Date(
    midpoint.getFullYear(),
    midpoint.getMonth(),
    midpoint.getDate(),
    APPROXIMATE_HOUR
  )

  // A midpoint can land in the future: on the 1st of a month "this month" is a
  // single day, and midday on it is still ahead of a viewer rating at 09:00.
  // A future `last_played_at` sorts to the top of the taste history forever and
  // sits outside every "last N days" window, so it is never allowed out.
  return resolved > now ? now : resolved
}
