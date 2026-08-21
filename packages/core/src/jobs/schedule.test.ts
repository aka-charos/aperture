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
  resolveScheduleDays,
  normalizeScheduleDays,
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
    scheduleDaysOfWeek: null,
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

/**
 * Multi-day weekly schedules.
 *
 * Two columns hold the answer -- an array added later, and the original scalar
 * kept so a rollback still reads a sane day -- so the pinned property is that
 * one resolver serves both the cron expression and the sentence an admin reads.
 * Two homes for one value is how this codebase's worst bugs have started.
 */
describe('resolveScheduleDays', () => {
  test('prefers the array', () => {
    assert.deepEqual(
      resolveScheduleDays({ scheduleDayOfWeek: 0, scheduleDaysOfWeek: [1, 4] }),
      [1, 4]
    )
  })

  test('falls back to the scalar for a row written before the array existed', () => {
    assert.deepEqual(resolveScheduleDays({ scheduleDayOfWeek: 3, scheduleDaysOfWeek: null }), [3])
  })

  test('an empty array is not a selection', () => {
    // The column rejects an empty array, but a caller can still construct one;
    // reading it as "no days" would produce the cron expression `0 4 * * `.
    assert.deepEqual(resolveScheduleDays({ scheduleDayOfWeek: 5, scheduleDaysOfWeek: [] }), [5])
  })

  test('nothing at all means Sunday, as it always did', () => {
    assert.deepEqual(resolveScheduleDays({ scheduleDayOfWeek: null, scheduleDaysOfWeek: null }), [0])
  })
})

describe('normalizeScheduleDays', () => {
  test('sorts and de-duplicates', () => {
    assert.deepEqual(normalizeScheduleDays([4, 1, 4, 0], 'weekly'), [0, 1, 4])
  })

  test('drops out-of-range days rather than clamping them', () => {
    // Clamping would turn a client bug into a job running on a day nobody chose.
    assert.deepEqual(normalizeScheduleDays([7, 2, -1], 'weekly'), [2])
  })

  test('a selection of nothing but rubbish reads as no selection', () => {
    assert.equal(normalizeScheduleDays([9, 12], 'weekly'), null)
    assert.equal(normalizeScheduleDays([], 'weekly'), null)
    assert.equal(normalizeScheduleDays(null, 'weekly'), null)
  })

  test('biweekly keeps only the earliest day', () => {
    // The every-other-week rule drops any firing under BIWEEKLY_MIN_DAYS after
    // the last completed run, so Monday+Thursday would silently mean "every
    // other Monday". Storing both would make the setting lie.
    assert.deepEqual(normalizeScheduleDays([1, 4], 'biweekly'), [1])
  })
})

describe('multi-day weekly schedules', () => {
  test('every selected day reaches the cron expression', () => {
    assert.equal(
      scheduleToCron(config({ scheduleType: 'weekly', scheduleDaysOfWeek: [1, 3, 5] })),
      '0 4 * * 1,3,5'
    )
  })

  test('a single-day array matches what the scalar always produced', () => {
    assert.equal(
      scheduleToCron(config({ scheduleType: 'weekly', scheduleDaysOfWeek: [3] })),
      scheduleToCron(config({ scheduleType: 'weekly', scheduleDayOfWeek: 3 }))
    )
  })

  test('the summary names the same days the cron does', () => {
    const label = formatSchedule(config({ scheduleType: 'weekly', scheduleDaysOfWeek: [1, 4] }))
    assert.match(label, /Monday/)
    assert.match(label, /Thursday/)
    assert.doesNotMatch(label, /Sunday/)
  })

  test('the array wins over a stale scalar in both readers', () => {
    // The scalar trails the array on write, but a hand-edited row could
    // disagree; whichever way, cron and prose must not diverge.
    const stale = config({ scheduleType: 'weekly', scheduleDayOfWeek: 0, scheduleDaysOfWeek: [2] })
    assert.equal(scheduleToCron(stale), '0 4 * * 2')
    assert.match(formatSchedule(stale), /Tuesday/)
  })
})
