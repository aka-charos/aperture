/**
 * Pins the biweekly schedule, which is the one cadence cron cannot express.
 *
 * A biweekly job carries the ordinary weekly cron expression and relies on
 * isBiweeklyRunDue to drop every second firing. That split means two things can
 * go wrong silently: the cron could stop matching the chosen day (the job runs
 * on the wrong date), or the window could be set so tight that no firing is
 * ever dropped (the job is weekly and nobody notices the setting did nothing).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  isBiweeklyRunDue,
  BIWEEKLY_MIN_DAYS,
  scheduleToCron,
  formatSchedule,
  type JobConfig,
} from './jobConfig.js'

const NOW = new Date('2026-08-10T12:00:00Z')

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
}

/** Sunday 04:00, the shipped default for the recommendation jobs. */
function config(overrides: Partial<JobConfig> = {}): JobConfig {
  return {
    jobName: 'generate-movie-recommendations',
    scheduleType: 'biweekly',
    scheduleHour: 4,
    scheduleMinute: 0,
    scheduleDayOfWeek: 0,
    scheduleIntervalHours: null,
    scheduleIntervalMinutes: null,
    isEnabled: true,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('isBiweeklyRunDue', () => {
  test('runs when the job has never run', () => {
    // A never-run job must not be blocked by a rule about its own history.
    assert.equal(isBiweeklyRunDue(null, NOW), true)
  })

  test('drops the off-week firing', () => {
    assert.equal(isBiweeklyRunDue(daysAgo(7), NOW), false)
  })

  test('runs on the on-week firing', () => {
    assert.equal(isBiweeklyRunDue(daysAgo(14), NOW), true)
  })

  test('tolerates a firing that lands a little under two weeks', () => {
    // Cron fires at the same wall-clock time weekly, so the gap between two
    // firings is 14 days give or take clock drift and a DST change. A 14-day
    // window would round the wrong way and slip the run a whole week.
    assert.ok(BIWEEKLY_MIN_DAYS < 14, 'window must leave room for clock drift')
    assert.equal(isBiweeklyRunDue(daysAgo(13.9), NOW), true)
  })

  test('still drops a firing one week later, with margin to spare', () => {
    // The other side of the same tolerance: widening the window past a week
    // would make biweekly behave as weekly.
    assert.ok(BIWEEKLY_MIN_DAYS > 8, 'window must comfortably exceed one week')
    assert.equal(isBiweeklyRunDue(daysAgo(7.5), NOW), false)
  })
})

describe('biweekly cron and label', () => {
  test('fires on the configured weekday, exactly like weekly', () => {
    // The dropping happens in the scheduler, not in the expression — if this
    // diverged from weekly the job would run on the wrong day entirely.
    const biweekly = scheduleToCron(config())
    const weekly = scheduleToCron(config({ scheduleType: 'weekly' }))
    assert.equal(biweekly, '0 4 * * 0')
    assert.equal(biweekly, weekly)
  })

  test('honours the chosen day and hour', () => {
    assert.equal(scheduleToCron(config({ scheduleDayOfWeek: 3, scheduleHour: 22 })), '0 22 * * 3')
  })

  test('is not scheduled at all when disabled', () => {
    assert.equal(scheduleToCron(config({ isEnabled: false })), null)
  })

  test('reads as a fortnightly cadence, not a weekly one', () => {
    const label = formatSchedule(config())
    assert.match(label, /2 weeks/)
    assert.match(label, /Sunday/)
    assert.notEqual(label, formatSchedule(config({ scheduleType: 'weekly' })))
  })
})
