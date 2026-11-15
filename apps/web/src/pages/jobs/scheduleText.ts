/**
 * A schedule in words, in the reader's language. One function for the schedule
 * dialog's preview and for any page that says when its job runs (the backup
 * page), so the two cannot describe one setting two ways. Pure, pinned by
 * scheduleText.test.ts.
 */

import type { TFunction } from 'i18next'
import type { JobSchedule, ScheduleType } from './types'
import { formatTimeOfDay, isSubHourInterval } from './scheduleForm'

export const WEEKDAY_KEYS = [
  'weekdaySun',
  'weekdayMon',
  'weekdayTue',
  'weekdayWed',
  'weekdayThu',
  'weekdayFri',
  'weekdaySat',
] as const

export const INTERVAL_META: { value: number; labelKey: string }[] = [
  { value: 15, labelKey: 'intervalEvery15m' },
  { value: 30, labelKey: 'intervalEvery30m' },
  { value: 60, labelKey: 'intervalEveryHour' },
  { value: 120, labelKey: 'intervalEvery2h' },
  { value: 180, labelKey: 'intervalEvery3h' },
  { value: 240, labelKey: 'intervalEvery4h' },
  { value: 360, labelKey: 'intervalEvery6h' },
  { value: 480, labelKey: 'intervalEvery8h' },
  { value: 720, labelKey: 'intervalEvery12h' },
]

export interface ScheduleTextValues {
  type: ScheduleType
  isEnabled: boolean
  hour: number
  minute: number
  /** Weekly: every day it fires on. */
  daysOfWeek: number[]
  /** Biweekly: its one day. */
  dayOfWeek: number
  intervalMinutes: number
}

/**
 * A stored schedule as the dialog reads it, with the dialog's defaults for
 * fields the row leaves empty (a schedule saved before multi-day existed
 * carries only the scalar day).
 */
export function scheduleTextValues(schedule: JobSchedule): ScheduleTextValues {
  return {
    type: schedule.type,
    isEnabled: schedule.isEnabled,
    hour: schedule.hour ?? 3,
    minute: schedule.minute ?? 0,
    daysOfWeek: schedule.daysOfWeek?.length ? schedule.daysOfWeek : [schedule.dayOfWeek ?? 0],
    dayOfWeek: schedule.dayOfWeek ?? 0,
    intervalMinutes:
      schedule.intervalMinutes ?? (schedule.intervalHours != null ? schedule.intervalHours * 60 : 360),
  }
}

const ui = (t: TFunction, key: string, options?: Record<string, unknown>): string =>
  t(`admin.jobsPage.ui.${key}`, options ?? {}) as string

function weekdayLabel(t: TFunction, day: number): string {
  const key = WEEKDAY_KEYS[day]
  return key ? ui(t, key) : ''
}

export function describeSchedule(values: ScheduleTextValues, t: TFunction, language: string): string {
  if (!values.isEnabled) return ui(t, 'configPreviewDisabled')

  const time = formatTimeOfDay(language, values.hour, values.minute)
  switch (values.type) {
    case 'daily':
      return ui(t, 'configPreviewDaily', { time })
    case 'weekly': {
      if (values.daysOfWeek.length === 0) return ui(t, 'configPreviewNoDays')
      // Week order whatever order they were picked in, so it reads the way the
      // toggles look.
      const day = [...values.daysOfWeek]
        .sort((a, b) => a - b)
        .map((d) => weekdayLabel(t, d))
        .join(ui(t, 'dayListSeparator'))
      return ui(t, 'configPreviewWeekly', { day, time })
    }
    case 'biweekly':
      return ui(t, 'configPreviewBiweekly', { day: weekdayLabel(t, values.dayOfWeek), time })
    case 'interval': {
      const labelKey = INTERVAL_META.find((i) => i.value === values.intervalMinutes)?.labelKey
      const interval = labelKey ? ui(t, labelKey) : ui(t, 'intervalFallback')
      // The 15- and 30-minute intervals run on the quarter and half hour.
      return isSubHourInterval(values.type, values.intervalMinutes)
        ? interval
        : ui(t, 'configPreviewIntervalAt', { interval, minute: String(values.minute).padStart(2, '0') })
    }
    case 'manual':
      return ui(t, 'configPreviewManualRuns')
    default:
      return ''
  }
}
