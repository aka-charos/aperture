/**
 * When a scheduled job next fires, worked out the way the scheduler fires it.
 *
 * The scheduler runs node-cron in the container's time zone (`TZ`, else
 * DEFAULT_SCHEDULER_TIME_ZONE), not the browser's. The Jobs page used to work
 * the next run out in the browser, so from another zone a daily job showed
 * hours off, and an interval job's minute offset was ignored. The answer is
 * decided here and shipped as `nextRunAt`.
 *
 * Pure: no database, no clock. The caller supplies `now` and, for a biweekly
 * job, the start of its last completed run (the scheduler's own rule).
 */

import { BIWEEKLY_MIN_DAYS, resolveScheduleDays, type JobConfig } from './jobConfig.js'

export const DEFAULT_SCHEDULER_TIME_ZONE = 'America/New_York'

/** The zone node-cron is given. One copy, read by the scheduler and the jobs list. */
export function schedulerTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  return env.TZ || DEFAULT_SCHEDULER_TIME_ZONE
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Far enough for a biweekly job whose last run was yesterday, plus a week. */
const SEARCH_DAYS = BIWEEKLY_MIN_DAYS + 9

type ScheduleFields = Pick<
  JobConfig,
  | 'scheduleType'
  | 'scheduleHour'
  | 'scheduleMinute'
  | 'scheduleDayOfWeek'
  | 'scheduleDaysOfWeek'
  | 'scheduleIntervalHours'
  | 'scheduleIntervalMinutes'
  | 'isEnabled'
>

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function wallClock(at: number, format: Intl.DateTimeFormat): WallClock {
  const parts: Record<string, number> = {}
  for (const part of format.formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Some engines write midnight as 24 under h23; it is the same instant.
    hour: parts.hour % 24,
    minute: parts.minute,
  }
}

/** How far the zone's clock is ahead of UTC at this instant. */
function offsetAt(at: number, format: Intl.DateTimeFormat): number {
  const c = wallClock(at, format)
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute) - Math.floor(at / 60_000) * 60_000
}

/** The instant the zone's clock reads this wall time (DST-aware, two passes). */
function instantOf(c: WallClock, format: Intl.DateTimeFormat): number {
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute)
  const first = asUtc - offsetAt(asUtc, format)
  const second = asUtc - offsetAt(first, format)
  return second
}

/** The wall times of day this schedule fires at, as [hour, minute] pairs. */
function timesOfDay(config: ScheduleFields): Array<[number, number]> {
  const minute = config.scheduleMinute ?? 0
  const hour = config.scheduleHour ?? 0
  if (config.scheduleType !== 'interval') return [[hour, minute]]

  // Mirrors scheduleToCron: 15 and 30 are `*/15` and `*/30` (no offset);
  // anything else is `${minute} */${hours}`.
  const subHour = config.scheduleIntervalMinutes
  if (subHour === 15 || subHour === 30) {
    const times: Array<[number, number]> = []
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += subHour) times.push([h, m])
    return times
  }
  const step = config.scheduleIntervalHours ?? 1
  const times: Array<[number, number]> = []
  for (let h = 0; h < 24; h += step) times.push([h, minute])
  return times
}

/**
 * The next instant the scheduler will run this job, or null when it never
 * will (manual, switched off, or a zone this runtime cannot read).
 */
export function nextScheduledRun(
  config: ScheduleFields,
  options: { now: Date; timeZone: string; lastCompletedAt?: Date | null }
): Date | null {
  if (!config.isEnabled || config.scheduleType === 'manual') return null

  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: options.timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
  } catch {
    return null
  }

  const now = options.now.getTime()
  const weekly = config.scheduleType === 'weekly' || config.scheduleType === 'biweekly'
  const days = weekly ? new Set(resolveScheduleDays(config)) : null
  // The scheduler drops a biweekly firing that comes under BIWEEKLY_MIN_DAYS
  // after the last completed run (isBiweeklyRunDue); so does this.
  const last =
    config.scheduleType === 'biweekly' && options.lastCompletedAt
      ? options.lastCompletedAt.getTime()
      : null
  const times = timesOfDay(config)
  const today = wallClock(now, format)

  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    // Calendar arithmetic on the zone's date, done in UTC so it has no DST.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset))
    if (days && !days.has(date.getUTCDay())) continue
    for (const [hour, minute] of times) {
      const at = instantOf(
        {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour,
          minute,
        },
        format
      )
      if (at <= now) continue
      if (last != null && (at - last) / DAY_MS < BIWEEKLY_MIN_DAYS) continue
      return new Date(at)
    }
  }
  return null
}
