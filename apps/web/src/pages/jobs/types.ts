export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: Record<string, unknown>
}

export type ScheduleType = 'daily' | 'weekly' | 'biweekly' | 'interval' | 'manual'

export interface JobSchedule {
  type: ScheduleType
  hour: number | null
  minute: number | null
  dayOfWeek: number | null
  /** Every day a weekly schedule fires on. Null on a schedule saved before multi-day existed. */
  daysOfWeek: number[] | null
  intervalHours: number | null
  intervalMinutes: number | null
  /** Configured items per run; null means the job's default. Absent on older API builds. */
  maxItemsPerRun?: number | null
  isEnabled: boolean
  formatted: string
}

/**
 * A job that works through at most N items per run, with N configurable.
 * Decided server-side: the bundle never holds a copy of the default or range.
 */
export interface JobRunLimit {
  default: number
  min: number
  max: number
  /** What one item is (an i18n context, e.g. `titles`). */
  unit: string
  /** The cap the next run will use: the configured value, or the default. */
  value: number
}

export interface JobProgress {
  jobId: string
  jobName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt?: string
  currentStep: string
  currentStepIndex: number
  totalSteps: number
  stepProgress: number
  overallProgress: number
  itemsProcessed: number
  itemsTotal: number
  currentItem?: string
  logs: LogEntry[]
  error?: string
  result?: Record<string, unknown>
}

export interface JobLastRun {
  id: string
  status: 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt: string
  durationMs: number
  itemsProcessed: number
  itemsTotal: number
  errorMessage: string | null
}

export interface JobRunRecord {
  id: string
  job_name: string
  status: 'completed' | 'failed' | 'cancelled'
  started_at: string
  completed_at: string
  duration_ms: number
  items_processed: number
  items_total: number
  error_message: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface Job {
  name: string
  description: string
  cron: string | null
  status: 'idle' | 'running' | 'failed'
  currentJobId?: string
  progress?: {
    overallProgress: number
    currentStep: string
    itemsProcessed: number
    itemsTotal: number
  }
  schedule?: JobSchedule | null
  lastRun?: JobLastRun | null
  manualOnly?: boolean
  runLimit?: JobRunLimit | null
}

export interface JobCategory {
  /** i18n key for category title (e.g. admin.jobs.categories.movieSync.title) */
  titleKey: string
  /** i18n key for category description */
  descriptionKey: string
  color: string
  jobs: string[]
}

