import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'

const logger = createChildLogger('job-config')

export type ScheduleType = 'daily' | 'weekly' | 'biweekly' | 'interval' | 'manual'

/**
 * Days that must have passed before a biweekly job runs again.
 *
 * Thirteen, not fourteen: cron fires at the same wall-clock time each week, so
 * two weeks later is *exactly* 14 days minus whatever drift the clock and a DST
 * change contribute. At 14 the second run would sometimes miss by seconds and
 * slip a whole week. Thirteen clears a one-week-old run (7) by a wide margin
 * and admits a two-week-old one every time.
 */
export const BIWEEKLY_MIN_DAYS = 13

/**
 * Has enough time passed for a biweekly job to run again?
 *
 * Cron has no way to say "every other week", so a biweekly schedule carries the
 * ordinary weekly expression and this check drops every second firing. Split
 * out from the database lookup so the arithmetic is testable.
 *
 * No previous run means run now — a job that has never run must not be blocked
 * by a rule about its own history.
 */
export function isBiweeklyRunDue(lastRunAt: Date | null, now: Date = new Date()): boolean {
  if (!lastRunAt) return true
  const daysSince = (now.getTime() - lastRunAt.getTime()) / (1000 * 60 * 60 * 24)
  return daysSince >= BIWEEKLY_MIN_DAYS
}

export interface JobConfig {
  jobName: string
  scheduleType: ScheduleType
  scheduleHour: number | null
  scheduleMinute: number | null
  /**
   * The earliest selected day, kept in step with scheduleDaysOfWeek.
   *
   * Not a second source of truth: every reader goes through
   * resolveScheduleDays, which prefers the array. It survives so that a build
   * predating the array column still finds a sane day here after a rollback.
   */
  scheduleDayOfWeek: number | null
  /** Every day a weekly schedule fires on. Null means "read the scalar". */
  scheduleDaysOfWeek: number[] | null
  scheduleIntervalHours: number | null
  /** 15 or 30 when set; mutually exclusive with scheduleIntervalHours for interval schedules */
  scheduleIntervalMinutes: number | null
  isEnabled: boolean
  updatedAt: Date
}

interface JobConfigRow {
  job_name: string
  schedule_type: string
  schedule_hour: number | null
  schedule_minute: number | null
  schedule_day_of_week: number | null
  schedule_days_of_week: number[] | null
  schedule_interval_hours: number | null
  schedule_interval_minutes: number | null
  is_enabled: boolean
  updated_at: Date
}

/**
 * The days a weekly schedule fires on, from whichever column holds them.
 *
 * One reader for two columns, so the cron expression and the human-readable
 * summary can never disagree about which days were picked -- the failure this
 * codebase keeps meeting when a value has two homes. An absent or empty array
 * falls back to the scalar, and an absent scalar means Sunday, matching what
 * scheduleToCron did before the array existed.
 */
export function resolveScheduleDays(config: {
  scheduleDayOfWeek: number | null
  scheduleDaysOfWeek?: number[] | null
}): number[] {
  const days = config.scheduleDaysOfWeek
  if (days && days.length > 0) return days
  return [config.scheduleDayOfWeek ?? 0]
}

/**
 * Clean a day selection on the way into the database.
 *
 * Sorted and de-duplicated because the cron field is read by humans and
 * `0,3,3,1` is a worse answer than `0,1,3` to the same question. Out-of-range
 * values are dropped rather than clamped: clamping would turn a client bug into
 * a schedule that runs on a day nobody chose.
 *
 * BIWEEKLY IS TRUNCATED TO ONE DAY. Cron has no "every other week", so a
 * biweekly job carries the weekly expression and isScheduledRunDue drops any
 * firing under BIWEEKLY_MIN_DAYS (13) after the last completed run. Two firings
 * in the same week are 3-4 days apart, so the second is always dropped --
 * selecting Monday and Thursday would silently mean "every other Monday". A
 * setting that cannot be honoured must not be stored as though it were.
 */
export function normalizeScheduleDays(
  days: number[] | null | undefined,
  scheduleType?: ScheduleType
): number[] | null {
  if (!days || days.length === 0) return null
  const valid = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b
  )
  if (valid.length === 0) return null
  return scheduleType === 'biweekly' ? valid.slice(0, 1) : valid
}

/**
 * Seed schedules for a job that has no `job_config` row yet.
 *
 * THIS IS NOT A REGISTRY OF JOBS, and treating it as one is what broke the
 * schedule dialog. `getValidJobNames()` used to return these keys, and the
 * config route used that to decide whether a job existed -- so a job registered
 * correctly in `definitions.ts`, the executor, `JOB_CATEGORIES` and the
 * database still answered **404 "Job not found"** on both GET and PATCH of its
 * schedule, from a dialog that had happily opened on defaults. Four jobs had
 * drifted out of it (`cleanup-auth-state`, `generate-title-analysis`,
 * `refresh-recommendation-explanations`, `refresh-ratings`) and nothing could
 * see the drift, because the two lists live in different packages.
 *
 * The catalogue in `apps/api/.../jobs/definitions.ts` is the registry; every
 * other jobs route already validated against it and the config route now does
 * too. What remains here is only a default *schedule*, and a job absent from it
 * is manual-only until someone configures it -- the safe direction, since the
 * alternative is a job acquiring a cadence nobody chose.
 *
 * `jobDefaults.test.ts` in apps/api fails on a scheduled job with no entry here
 * and on an entry naming a job that does not exist.
 *
 * Jobs at the same interval are staggered by minute offset to avoid contention.
 */
export const JOB_SCHEDULE_DEFAULTS: Record<
  string,
  {
    scheduleType: ScheduleType
    hour: number
    minute: number
    intervalHours?: number
    intervalMinutes?: number
    dayOfWeek?: number
  }
> = {
  // === EVERY 30 MINUTES ===
  'sync-users': { scheduleType: 'interval', hour: 0, minute: 0, intervalMinutes: 30 },

  // === EVERY HOUR (staggered by 15 mins) ===
  'sync-series-watch-history': { scheduleType: 'interval', hour: 0, minute: 0, intervalHours: 1 },
  'sync-watching-favorites': { scheduleType: 'interval', hour: 0, minute: 30, intervalHours: 1 },

  // === EVERY 2 HOURS ===
  'sync-movie-watch-history': { scheduleType: 'interval', hour: 0, minute: 0, intervalHours: 2 },

  // === EVERY 3 HOURS (staggered by 10 mins) ===
  'sync-movies': { scheduleType: 'interval', hour: 0, minute: 0, intervalHours: 3 },
  'sync-series': { scheduleType: 'interval', hour: 0, minute: 10, intervalHours: 3 },
  'sync-movie-libraries': { scheduleType: 'interval', hour: 0, minute: 20, intervalHours: 3 },
  'sync-series-libraries': { scheduleType: 'interval', hour: 0, minute: 30, intervalHours: 3 },

  // === EVERY 6 HOURS (staggered by 10 mins) ===
  'enrich-metadata': { scheduleType: 'interval', hour: 0, minute: 0, intervalHours: 6 },
  'generate-movie-embeddings': { scheduleType: 'interval', hour: 0, minute: 10, intervalHours: 6 },
  'generate-series-embeddings': { scheduleType: 'interval', hour: 0, minute: 20, intervalHours: 6 },
  'sync-trakt-ratings': { scheduleType: 'interval', hour: 0, minute: 30, intervalHours: 6 },

  // === DAILY ===
  'backup-database': { scheduleType: 'daily', hour: 2, minute: 0 },
  // Ahead of the recommendation run, so a regenerate scores against the
  // ratings that were refreshed the same night rather than the previous day's.
  'refresh-ratings': { scheduleType: 'daily', hour: 2, minute: 30 },
  'sync-lldap-emails': { scheduleType: 'daily', hour: 3, minute: 15 },
  'cleanup-auth-state': { scheduleType: 'daily', hour: 3, minute: 30 },
  'refresh-top-picks': { scheduleType: 'daily', hour: 5, minute: 0 },
  'enrich-studio-logos': { scheduleType: 'daily', hour: 5, minute: 30 },
  'enrich-mdblist': { scheduleType: 'daily', hour: 7, minute: 0 },
  'generate-discovery-suggestions': { scheduleType: 'daily', hour: 6, minute: 0 },
  // Scheduled ahead of generate-discovery-suggestions (06:00) on purpose: the
  // exclusion set is rebuilt from request status at the start of every run, so
  // reconciling first is what lets a title declined in Seerr come back in the
  // same night's suggestions rather than a day later.
  'reconcile-discovery-requests': { scheduleType: 'daily', hour: 4, minute: 30 },

  // === WEEKLY (Sunday) ===
  'refresh-assistant-suggestions': { scheduleType: 'weekly', hour: 0, minute: 0, dayOfWeek: 0 },
  'generate-movie-recommendations': { scheduleType: 'weekly', hour: 4, minute: 0, dayOfWeek: 0 },
  'generate-series-recommendations': { scheduleType: 'weekly', hour: 4, minute: 0, dayOfWeek: 0 },
  'refresh-ai-pricing': { scheduleType: 'weekly', hour: 0, minute: 0, dayOfWeek: 0 },
  'auto-request-top-picks': { scheduleType: 'weekly', hour: 0, minute: 0, dayOfWeek: 0 },

  // === MANUAL ONLY ===
  'full-reset-movie-recommendations': { scheduleType: 'manual', hour: 0, minute: 0 },
  'full-reset-series-recommendations': { scheduleType: 'manual', hour: 0, minute: 0 },
  'refresh-library-gaps': { scheduleType: 'manual', hour: 0, minute: 0 },
  // Deliberately manual: each profile already carries its own
  // refresh_interval_days, so this exists for the one-off sweep after an
  // algorithm change, not as an ongoing schedule.
  'rebuild-taste-profiles': { scheduleType: 'manual', hour: 0, minute: 0 },
  'evaluate-recommender': { scheduleType: 'manual', hour: 0, minute: 0 },
  'refresh-embedding-centering': { scheduleType: 'manual', hour: 0, minute: 0 },
  'refresh-recommendation-explanations': { scheduleType: 'manual', hour: 0, minute: 0 },
  'generate-title-analysis': { scheduleType: 'manual', hour: 0, minute: 0 },
}

const CONFIG_COLUMNS = `job_name, schedule_type, schedule_hour, schedule_minute,
            schedule_day_of_week, schedule_days_of_week, schedule_interval_hours,
            schedule_interval_minutes, is_enabled, updated_at`

function rowToConfig(row: JobConfigRow): JobConfig {
  return {
    jobName: row.job_name,
    scheduleType: row.schedule_type as ScheduleType,
    scheduleHour: row.schedule_hour,
    scheduleMinute: row.schedule_minute,
    scheduleDayOfWeek: row.schedule_day_of_week,
    scheduleDaysOfWeek: row.schedule_days_of_week,
    scheduleIntervalHours: row.schedule_interval_hours,
    scheduleIntervalMinutes: row.schedule_interval_minutes,
    isEnabled: row.is_enabled,
    updatedAt: row.updated_at,
  }
}

/**
 * Get job configuration from the database, falling back to a seed schedule.
 *
 * Never returns null. A job with no row and no entry in JOB_SCHEDULE_DEFAULTS
 * reads as manual-only, which is what an unconfigured job should be -- the
 * previous null meant the config route answered 404 for exactly the jobs whose
 * schedule nobody had set yet, which is the one case a schedule dialog exists
 * for. Callers are expected to have checked the name against the job catalogue
 * first; every jobs route does.
 */
export async function getJobConfig(jobName: string): Promise<JobConfig> {
  const result = await queryOne<JobConfigRow>(
    `SELECT ${CONFIG_COLUMNS}
     FROM job_config
     WHERE job_name = $1`,
    [jobName]
  )

  if (result) {
    return rowToConfig(result)
  }

  const defaultConfig = JOB_SCHEDULE_DEFAULTS[jobName]
  const dayOfWeek = defaultConfig?.dayOfWeek ?? null
  return {
    jobName,
    scheduleType: defaultConfig?.scheduleType ?? 'manual',
    scheduleHour: defaultConfig?.hour ?? null,
    scheduleMinute: defaultConfig?.minute ?? null,
    scheduleDayOfWeek: dayOfWeek,
    scheduleDaysOfWeek: dayOfWeek === null ? null : [dayOfWeek],
    scheduleIntervalHours: defaultConfig?.intervalHours ?? null,
    scheduleIntervalMinutes: defaultConfig?.intervalMinutes ?? null,
    isEnabled: true,
    updatedAt: new Date(),
  }
}

/**
 * Get all job configurations
 */
export async function getAllJobConfigs(): Promise<JobConfig[]> {
  const result = await query<JobConfigRow>(
    `SELECT ${CONFIG_COLUMNS}
     FROM job_config
     ORDER BY job_name`
  )

  const configs = result.rows.map(rowToConfig)

  // Add any job that has no row yet, so a fresh install still schedules on the
  // seed cadence rather than waiting for someone to open the dialog.
  const existingNames = new Set(configs.map((c) => c.jobName))
  for (const jobName of Object.keys(JOB_SCHEDULE_DEFAULTS)) {
    if (!existingNames.has(jobName)) {
      configs.push(await getJobConfig(jobName))
    }
  }

  return configs
}

/**
 * Update job configuration
 */
export async function setJobConfig(
  jobName: string,
  config: {
    scheduleType?: ScheduleType
    scheduleHour?: number | null
    scheduleMinute?: number | null
    scheduleDayOfWeek?: number | null
    scheduleDaysOfWeek?: number[] | null
    scheduleIntervalHours?: number | null
    scheduleIntervalMinutes?: number | null
    isEnabled?: boolean
  }
): Promise<JobConfig> {
  // The array is the selection; the scalar trails it at the earliest day so a
  // rollback to a build without the column still reads a sensible schedule.
  // A caller sending only the old scalar (an older client, or a settings
  // handler that has no day picker) still gets a one-day array here.
  const days = normalizeScheduleDays(
    config.scheduleDaysOfWeek ??
      (config.scheduleDayOfWeek == null ? null : [config.scheduleDayOfWeek]),
    config.scheduleType
  )

  const result = await queryOne<JobConfigRow>(
    `INSERT INTO job_config (job_name, schedule_type, schedule_hour, schedule_minute,
                             schedule_day_of_week, schedule_days_of_week, schedule_interval_hours,
                             schedule_interval_minutes, is_enabled)
     VALUES ($1, $2, $3, $4, $5, $9, $6, $7, $8)
     ON CONFLICT (job_name) DO UPDATE SET
       schedule_type = COALESCE($2, job_config.schedule_type),
       schedule_hour = CASE WHEN $2 IS NOT NULL THEN $3 ELSE job_config.schedule_hour END,
       schedule_minute = CASE WHEN $2 IS NOT NULL THEN $4 ELSE job_config.schedule_minute END,
       schedule_day_of_week = CASE WHEN $2 IS NOT NULL THEN $5 ELSE job_config.schedule_day_of_week END,
       schedule_days_of_week = CASE WHEN $2 IS NOT NULL THEN $9 ELSE job_config.schedule_days_of_week END,
       schedule_interval_hours = CASE WHEN $2 IS NOT NULL THEN $6 ELSE job_config.schedule_interval_hours END,
       schedule_interval_minutes = CASE WHEN $2 IS NOT NULL THEN $7 ELSE job_config.schedule_interval_minutes END,
       is_enabled = COALESCE($8, job_config.is_enabled),
       updated_at = NOW()
     RETURNING ${CONFIG_COLUMNS}`,
    [
      jobName,
      config.scheduleType ?? 'daily',
      config.scheduleHour ?? null,
      config.scheduleMinute ?? null,
      days === null ? null : days[0],
      config.scheduleIntervalHours ?? null,
      config.scheduleIntervalMinutes ?? null,
      config.isEnabled ?? true,
      days,
    ]
  )

  if (!result) {
    throw new Error(`Failed to update job config for ${jobName}`)
  }

  logger.info({ jobName, config }, 'Job config updated')
  return rowToConfig(result)
}

/**
 * Convert schedule config to cron expression (for internal scheduler use)
 */
export function scheduleToCron(config: JobConfig): string | null {
  if (!config.isEnabled || config.scheduleType === 'manual') {
    return null
  }

  const minute = config.scheduleMinute ?? 0
  const hour = config.scheduleHour ?? 0

  switch (config.scheduleType) {
    case 'daily':
      return `${minute} ${hour} * * *`

    // Biweekly deliberately produces the *weekly* expression. Cron cannot
    // express "every other week", so the task fires every week and
    // isBiweeklyRunDue drops the off-week firings (see scheduler.ts).
    //
    // A weekly schedule may name several days; cron's day-of-week field has
    // always taken a list. normalizeScheduleDays keeps biweekly to one, since
    // the drop rule would eat any second firing in the same week.
    case 'weekly':
    case 'biweekly': {
      return `${minute} ${hour} * * ${resolveScheduleDays(config).join(',')}`
    }

    case 'interval': {
      const intervalMins = config.scheduleIntervalMinutes
      if (intervalMins === 15) {
        return '*/15 * * * *'
      }
      if (intervalMins === 30) {
        return '*/30 * * * *'
      }
      const intervalHours = config.scheduleIntervalHours ?? 1
      // Use minute offset for staggering jobs at the same interval
      return `${minute} */${intervalHours} * * *`
    }

    default:
      return null
  }
}

/**
 * Format schedule config to human-readable string
 */
export function formatSchedule(config: JobConfig): string {
  if (!config.isEnabled) {
    return 'Disabled'
  }

  if (config.scheduleType === 'manual') {
    return 'Manual only'
  }

  const formatTime = (hour: number, minute: number): string => {
    const h = hour % 12 || 12
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const m = minute.toString().padStart(2, '0')
    return `${h}:${m} ${ampm}`
  }

  const hour = config.scheduleHour ?? 0
  const minute = config.scheduleMinute ?? 0

  switch (config.scheduleType) {
    case 'daily':
      return `Daily at ${formatTime(hour, minute)}`

    case 'weekly':
    case 'biweekly': {
      const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      // Same resolver as scheduleToCron, so the sentence an admin reads and the
      // expression the scheduler runs cannot describe different days.
      const dayNames = resolveScheduleDays(config).map((d) => names[d])
      const cadence = config.scheduleType === 'biweekly' ? 'Every 2 weeks on' : 'Weekly on'
      return `${cadence} ${dayNames.join(', ')} at ${formatTime(hour, minute)}`
    }

    case 'interval': {
      const intervalMins = config.scheduleIntervalMinutes
      if (intervalMins === 15) {
        return 'Every 15 minutes'
      }
      if (intervalMins === 30) {
        return 'Every 30 minutes'
      }
      const hours = config.scheduleIntervalHours ?? 1
      // Show minute offset if non-zero (for staggered jobs)
      if (minute > 0) {
        return hours === 1 ? `Every hour at :${minute.toString().padStart(2, '0')}` : `Every ${hours} hours at :${minute.toString().padStart(2, '0')}`
      }
      return hours === 1 ? 'Every hour' : `Every ${hours} hours`
    }

    default:
      return 'Unknown schedule'
  }
}

/**
 * Should a scheduled firing of this job actually execute?
 *
 * Every schedule type except biweekly is fully described by its cron
 * expression, so this only ever says no to a biweekly job whose previous run is
 * too recent. Manual runs never reach here — clicking Run is someone asking for
 * the work regardless of cadence.
 *
 * Only `completed` runs count. A failed or cancelled run did not do the work,
 * and waiting another fortnight to retry would turn one bad night into a month
 * of stale picks.
 *
 * Fails open like the rest of the scheduling path: an unreadable history means
 * run the job, because skipping on a database hiccup would be indistinguishable
 * from the schedule silently breaking.
 */
export async function isScheduledRunDue(
  jobName: string,
  scheduleType: ScheduleType,
  now: Date = new Date()
): Promise<{ due: boolean; lastRunAt: Date | null }> {
  if (scheduleType !== 'biweekly') return { due: true, lastRunAt: null }

  try {
    const lastRun = await queryOne<{ started_at: Date }>(
      `SELECT started_at FROM job_runs
        WHERE job_name = $1 AND status = 'completed'
        ORDER BY started_at DESC
        LIMIT 1`,
      [jobName]
    )

    const lastRunAt = lastRun?.started_at ?? null
    return { due: isBiweeklyRunDue(lastRunAt, now), lastRunAt }
  } catch (err) {
    logger.warn({ err, jobName }, 'Could not read job history for biweekly check, running anyway')
    return { due: true, lastRunAt: null }
  }
}

// getValidJobNames() used to live here, returning the keys of the defaults map
// above. It was the wrong authority -- see the comment on JOB_SCHEDULE_DEFAULTS
// -- and is deliberately gone rather than fixed: the jobs routes validate
// against their own catalogue, which is the list that decides what a job is.
