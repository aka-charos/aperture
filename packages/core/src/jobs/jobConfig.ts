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
  scheduleDayOfWeek: number | null
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
  schedule_interval_hours: number | null
  schedule_interval_minutes: number | null
  is_enabled: boolean
  updated_at: Date
}

// Default schedules (configurable via Admin → Jobs)
// Jobs at same intervals are staggered by minute offset to avoid resource contention
const ENV_DEFAULTS: Record<
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
  'sync-lldap-emails': { scheduleType: 'daily', hour: 3, minute: 15 },
  'refresh-top-picks': { scheduleType: 'daily', hour: 5, minute: 0 },
  'enrich-studio-logos': { scheduleType: 'daily', hour: 5, minute: 30 },
  'enrich-mdblist': { scheduleType: 'daily', hour: 7, minute: 0 },
  'generate-discovery-suggestions': { scheduleType: 'daily', hour: 6, minute: 0 },

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
}

function rowToConfig(row: JobConfigRow): JobConfig {
  return {
    jobName: row.job_name,
    scheduleType: row.schedule_type as ScheduleType,
    scheduleHour: row.schedule_hour,
    scheduleMinute: row.schedule_minute,
    scheduleDayOfWeek: row.schedule_day_of_week,
    scheduleIntervalHours: row.schedule_interval_hours,
    scheduleIntervalMinutes: row.schedule_interval_minutes,
    isEnabled: row.is_enabled,
    updatedAt: row.updated_at,
  }
}

/**
 * Get job configuration from database, falling back to ENV defaults
 */
export async function getJobConfig(jobName: string): Promise<JobConfig | null> {
  const result = await queryOne<JobConfigRow>(
    `SELECT job_name, schedule_type, schedule_hour, schedule_minute,
            schedule_day_of_week, schedule_interval_hours, schedule_interval_minutes, is_enabled, updated_at
     FROM job_config
     WHERE job_name = $1`,
    [jobName]
  )

  if (result) {
    return rowToConfig(result)
  }

  // Fall back to defaults if not in database
  const defaultConfig = ENV_DEFAULTS[jobName]
  if (defaultConfig) {
    return {
      jobName,
      scheduleType: defaultConfig.scheduleType,
      scheduleHour: defaultConfig.hour,
      scheduleMinute: defaultConfig.minute,
      scheduleDayOfWeek: defaultConfig.dayOfWeek ?? null,
      scheduleIntervalHours: defaultConfig.intervalHours ?? null,
      scheduleIntervalMinutes: defaultConfig.intervalMinutes ?? null,
      isEnabled: true,
      updatedAt: new Date(),
    }
  }

  return null
}

/**
 * Get all job configurations
 */
export async function getAllJobConfigs(): Promise<JobConfig[]> {
  const result = await query<JobConfigRow>(
    `SELECT job_name, schedule_type, schedule_hour, schedule_minute,
            schedule_day_of_week, schedule_interval_hours, schedule_interval_minutes, is_enabled, updated_at
     FROM job_config
     ORDER BY job_name`
  )

  const configs = result.rows.map(rowToConfig)

  // Add any missing jobs from ENV_DEFAULTS
  const existingNames = new Set(configs.map((c) => c.jobName))
  for (const jobName of Object.keys(ENV_DEFAULTS)) {
    if (!existingNames.has(jobName)) {
      const config = await getJobConfig(jobName)
      if (config) configs.push(config)
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
    scheduleIntervalHours?: number | null
    scheduleIntervalMinutes?: number | null
    isEnabled?: boolean
  }
): Promise<JobConfig> {
  const result = await queryOne<JobConfigRow>(
    `INSERT INTO job_config (job_name, schedule_type, schedule_hour, schedule_minute,
                             schedule_day_of_week, schedule_interval_hours, schedule_interval_minutes, is_enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (job_name) DO UPDATE SET
       schedule_type = COALESCE($2, job_config.schedule_type),
       schedule_hour = CASE WHEN $2 IS NOT NULL THEN $3 ELSE job_config.schedule_hour END,
       schedule_minute = CASE WHEN $2 IS NOT NULL THEN $4 ELSE job_config.schedule_minute END,
       schedule_day_of_week = CASE WHEN $2 IS NOT NULL THEN $5 ELSE job_config.schedule_day_of_week END,
       schedule_interval_hours = CASE WHEN $2 IS NOT NULL THEN $6 ELSE job_config.schedule_interval_hours END,
       schedule_interval_minutes = CASE WHEN $2 IS NOT NULL THEN $7 ELSE job_config.schedule_interval_minutes END,
       is_enabled = COALESCE($8, job_config.is_enabled),
       updated_at = NOW()
     RETURNING job_name, schedule_type, schedule_hour, schedule_minute,
               schedule_day_of_week, schedule_interval_hours, schedule_interval_minutes, is_enabled, updated_at`,
    [
      jobName,
      config.scheduleType ?? 'daily',
      config.scheduleHour ?? null,
      config.scheduleMinute ?? null,
      config.scheduleDayOfWeek ?? null,
      config.scheduleIntervalHours ?? null,
      config.scheduleIntervalMinutes ?? null,
      config.isEnabled ?? true,
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
    case 'weekly':
    case 'biweekly': {
      const dayOfWeek = config.scheduleDayOfWeek ?? 0
      return `${minute} ${hour} * * ${dayOfWeek}`
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
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      const dayName = days[config.scheduleDayOfWeek ?? 0]
      const cadence = config.scheduleType === 'biweekly' ? 'Every 2 weeks on' : 'Weekly on'
      return `${cadence} ${dayName} at ${formatTime(hour, minute)}`
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

/**
 * Get list of valid job names
 */
export function getValidJobNames(): string[] {
  return Object.keys(ENV_DEFAULTS)
}
