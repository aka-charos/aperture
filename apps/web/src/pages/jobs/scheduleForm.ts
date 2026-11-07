/**
 * What the schedule dialog saves, from what it shows. Pure, and pinned by
 * scheduleForm.test.ts, because this is where a job's minute used to be lost:
 * every save sent minute 0 (or none for an interval job), which put a job
 * seeded at :10 or 05:45 back on the hour the first time anyone opened the
 * dialog.
 */

import type { ScheduleType } from './types'

/** Interval lengths below an hour run on cron's quarter or half hour. */
export function isSubHourInterval(type: ScheduleType, intervalMinutes: number): boolean {
  return type === 'interval' && intervalMinutes < 60
}

/** The schedule types that take a minute: those with a time of day, and hourly-or-longer intervals. */
export function scheduleTakesMinute(type: ScheduleType, intervalMinutes: number): boolean {
  if (type === 'manual') return false
  return type !== 'interval' || !isSubHourInterval(type, intervalMinutes)
}

/** A minute as typed: whole 0 to 59, else undefined (the field shows an error). */
export function parseMinute(text: string): number | undefined {
  const trimmed = text.trim()
  if (!/^\d{1,2}$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return value <= 59 ? value : undefined
}

export interface ScheduleFormValues {
  type: ScheduleType
  hour: number
  minute: number
  intervalMinutes: number
}

export interface SchedulePayloadTiming {
  scheduleHour: number | null
  scheduleMinute: number | null
  scheduleIntervalHours?: number
  scheduleIntervalMinutes?: number
}

/**
 * The time fields of a save. No minute for manual or a sub-hour interval: the
 * server then reads the job's seed minute, which is what it falls back to.
 * The day fields stay in the dialog, which owns the weekly/biweekly split.
 */
export function scheduleTimingPayload(values: ScheduleFormValues): SchedulePayloadTiming {
  const { type, hour, minute, intervalMinutes } = values
  const payload: SchedulePayloadTiming = {
    scheduleHour: type === 'interval' || type === 'manual' ? null : hour,
    scheduleMinute: scheduleTakesMinute(type, intervalMinutes) ? minute : null,
  }
  if (type === 'interval') {
    if (isSubHourInterval(type, intervalMinutes)) payload.scheduleIntervalMinutes = intervalMinutes
    else payload.scheduleIntervalHours = intervalMinutes / 60
  }
  return payload
}

/**
 * A time of day as a label, in the reader's locale: one formatter for the hour
 * picker and the preview, so the dialog never shows one setting two ways.
 * Formatted in UTC only so no zone shifts the wall time; the schedule itself
 * runs in the server's zone, which the dialog names.
 */
export function formatTimeOfDay(language: string, hour: number, minute: number): string {
  return new Intl.DateTimeFormat(language, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(Date.UTC(2000, 0, 1, hour, minute))
}
