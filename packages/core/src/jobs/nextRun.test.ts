import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { nextScheduledRun, schedulerTimeZone, DEFAULT_SCHEDULER_TIME_ZONE } from './nextRun.js'
import type { JobConfig } from './jobConfig.js'

const base = {
  scheduleHour: null,
  scheduleMinute: null,
  scheduleDayOfWeek: null,
  scheduleDaysOfWeek: null,
  scheduleIntervalHours: null,
  scheduleIntervalMinutes: null,
  isEnabled: true,
} satisfies Partial<JobConfig>

const NY = 'America/New_York'
const at = (iso: string) => new Date(iso)
const next = (
  config: Partial<JobConfig> & Pick<JobConfig, 'scheduleType'>,
  now: string,
  timeZone = NY,
  lastCompletedAt?: string
) =>
  nextScheduledRun(
    { ...base, ...config },
    { now: at(now), timeZone, lastCompletedAt: lastCompletedAt ? at(lastCompletedAt) : null }
  )?.toISOString() ?? null

describe('nextScheduledRun', () => {
  it('reads a daily time in the scheduler zone, not UTC or the browser', () => {
    // 03:30 in New York in November (EST, UTC-5) is 08:30 UTC.
    assert.equal(
      next({ scheduleType: 'daily', scheduleHour: 3, scheduleMinute: 30 }, '2026-11-07T12:00:00Z'),
      '2026-11-08T08:30:00.000Z'
    )
    assert.equal(
      next({ scheduleType: 'daily', scheduleHour: 3, scheduleMinute: 30 }, '2026-11-08T08:00:00Z'),
      '2026-11-08T08:30:00.000Z'
    )
  })

  it('a time exactly now is already past', () => {
    assert.equal(
      next({ scheduleType: 'daily', scheduleHour: 3, scheduleMinute: 30 }, '2026-11-08T08:30:00Z'),
      '2026-11-09T08:30:00.000Z'
    )
  })

  it('follows a DST change: 03:00 is UTC-4 before it and UTC-5 after', () => {
    // US DST ended 2026-11-01.
    assert.equal(
      next({ scheduleType: 'daily', scheduleHour: 3, scheduleMinute: 0 }, '2026-10-31T12:00:00Z'),
      '2026-11-01T08:00:00.000Z'
    )
    assert.equal(
      next({ scheduleType: 'daily', scheduleHour: 3, scheduleMinute: 0 }, '2026-10-30T12:00:00Z'),
      '2026-10-31T07:00:00.000Z'
    )
  })

  it('keeps an interval job on its minute offset and its hour step', () => {
    // `40 */3`: 00:40, 03:40, 06:40 … New York time. 07:00 NY → 09:40 NY = 14:40 UTC.
    assert.equal(
      next(
        { scheduleType: 'interval', scheduleIntervalHours: 3, scheduleMinute: 40 },
        '2026-11-07T12:00:00Z'
      ),
      '2026-11-07T14:40:00.000Z'
    )
    // Hourly at :05.
    assert.equal(
      next(
        { scheduleType: 'interval', scheduleIntervalHours: 1, scheduleMinute: 5 },
        '2026-11-07T12:06:00Z'
      ),
      '2026-11-07T13:05:00.000Z'
    )
  })

  it('a sub-hour interval ignores the minute, as its cron does', () => {
    assert.equal(
      next(
        { scheduleType: 'interval', scheduleIntervalMinutes: 15, scheduleMinute: 7 },
        '2026-11-07T12:16:00Z'
      ),
      '2026-11-07T12:30:00.000Z'
    )
  })

  it('takes the soonest of several weekdays', () => {
    // Saturday 2026-11-07 07:00 NY. Mon (1) and Sat (6) at 04:00: Saturday's has
    // passed, so Monday.
    assert.equal(
      next(
        { scheduleType: 'weekly', scheduleDaysOfWeek: [1, 6], scheduleHour: 4, scheduleMinute: 0 },
        '2026-11-07T12:00:00Z'
      ),
      '2026-11-09T09:00:00.000Z'
    )
  })

  it('skips a biweekly firing the scheduler would drop', () => {
    const weekly = { scheduleDaysOfWeek: [0], scheduleHour: 4, scheduleMinute: 0 }
    // Sunday 2026-11-08 04:00 NY = 09:00 UTC. Last completed run a week before.
    assert.equal(
      next({ scheduleType: 'biweekly', ...weekly }, '2026-11-07T12:00:00Z', NY, '2026-11-01T09:00:00Z'),
      '2026-11-15T09:00:00.000Z'
    )
    // Two weeks before: due this Sunday.
    assert.equal(
      next({ scheduleType: 'biweekly', ...weekly }, '2026-11-07T12:00:00Z', NY, '2026-10-25T08:00:00Z'),
      '2026-11-08T09:00:00.000Z'
    )
    // Never ran: the next Sunday.
    assert.equal(
      next({ scheduleType: 'biweekly', ...weekly }, '2026-11-07T12:00:00Z'),
      '2026-11-08T09:00:00.000Z'
    )
  })

  it('answers null for manual, switched off, or an unreadable zone', () => {
    assert.equal(next({ scheduleType: 'manual' }, '2026-11-07T12:00:00Z'), null)
    assert.equal(
      next({ scheduleType: 'daily', scheduleHour: 3, isEnabled: false }, '2026-11-07T12:00:00Z'),
      null
    )
    assert.equal(
      next({ scheduleType: 'daily', scheduleHour: 3 }, '2026-11-07T12:00:00Z', 'Not/AZone'),
      null
    )
  })

  it('works in a zone with a half-hour offset', () => {
    // Asia/Kolkata is UTC+5:30: 02:00 there is 20:30 UTC the day before.
    assert.equal(
      next({ scheduleType: 'daily', scheduleHour: 2, scheduleMinute: 0 }, '2026-11-07T12:00:00Z', 'Asia/Kolkata'),
      '2026-11-07T20:30:00.000Z'
    )
  })
})

describe('schedulerTimeZone', () => {
  it('reads TZ, else the default the scheduler has always used', () => {
    assert.equal(schedulerTimeZone({ TZ: 'Europe/Athens' }), 'Europe/Athens')
    assert.equal(schedulerTimeZone({}), DEFAULT_SCHEDULER_TIME_ZONE)
    assert.equal(schedulerTimeZone({ TZ: '' }), DEFAULT_SCHEDULER_TIME_ZONE)
  })
})
