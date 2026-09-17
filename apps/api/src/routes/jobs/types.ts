/**
 * Jobs TypeScript Interfaces
 */

export interface JobInfo {
  name: string
  description: string
  cron: string | null
  lastRun: Date | null
  status: 'idle' | 'running' | 'failed'
  currentJobId?: string
  manualOnly?: boolean
}

export interface JobDefinition {
  name: string
  description: string
  cron: string | null
  manualOnly?: boolean
  /**
   * Declares that each run works through at most N items and that the operator
   * may choose N. Absent means the job takes no limit, and the config route
   * refuses one. See `runLimit.ts`.
   */
  runLimit?: JobRunLimit
}

export interface JobRunLimit {
  /** What an unset `job_config.max_items_per_run` means. */
  default: number
  min: number
  max: number
  /**
   * What one item is, for the dialog's wording. An i18n context, so a unit
   * the web bundle has no string for falls back to the generic "items".
   */
  unit: string
}

export interface JobProgress {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  currentStep: string
  overallProgress: number
  itemsProcessed: number
  itemsTotal: number
  logs: Array<{ timestamp: Date; level: string; message: string }>
  result?: Record<string, unknown>
}

export interface JobConfigUpdate {
  scheduleType?: 'daily' | 'weekly' | 'interval' | 'manual'
  scheduleHour?: number | null
  scheduleMinute?: number | null
  scheduleDayOfWeek?: number | null
  scheduleIntervalHours?: number | null
  scheduleIntervalMinutes?: number | null
  isEnabled?: boolean
}
