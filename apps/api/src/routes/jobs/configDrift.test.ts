/**
 * The `job_config` table is the third list of job names and the only one no
 * build can check. See `configDrift.ts` for what that cost; these assertions
 * cover the comparison itself, which is pure precisely so it can be exercised
 * without a database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { JobConfig } from '@aperture/core'

import { findJobConfigDrift, reportJobConfigDrift } from './configDrift.js'
import { jobDefinitions } from './definitions.js'

const REGISTERED = jobDefinitions.map((j) => j.name)

function config(jobName: string, overrides: Partial<JobConfig> = {}): JobConfig {
  return {
    jobName,
    scheduleType: 'daily',
    scheduleHour: 4,
    scheduleMinute: 0,
    scheduleDayOfWeek: null,
    scheduleDaysOfWeek: null,
    scheduleIntervalHours: null,
    scheduleIntervalMinutes: null,
    isEnabled: true,
    updatedAt: new Date(),
    ...overrides,
  }
}

test('the two rows that actually did this are recognised', () => {
  // Both were real job names until January, both were split by media type, and
  // both rows outlived the rename. Named here rather than described because
  // they are the measurement: 0164 deleted exactly these.
  const drift = findJobConfigDrift(
    [
      config('generate-recommendations'),
      config('sync-watch-history', { scheduleHour: 3 }),
      config('generate-movie-recommendations'),
      config('sync-movie-watch-history'),
    ],
    REGISTERED
  )

  assert.deepEqual(
    drift.orphans.map((o) => o.jobName),
    ['generate-recommendations', 'sync-watch-history']
  )
  assert.equal(drift.scheduled.length, 2, 'both had a live cadence, so both fired nightly')
})

test('a catalogue that matches the table reports nothing', () => {
  const drift = findJobConfigDrift(
    REGISTERED.map((name) => config(name)),
    REGISTERED
  )
  assert.deepEqual(drift.orphans, [])
  assert.deepEqual(drift.scheduled, [])
})

test('a registered job with no row is not drift', () => {
  // The other direction is benign and already guarded by jobDefaults.test.ts:
  // getJobConfig falls back to the seed cadence, and to manual-only when there
  // is not even one of those. Reporting it here would be noise on every fresh
  // instance, where the table starts empty.
  const drift = findJobConfigDrift([], REGISTERED)
  assert.deepEqual(drift.orphans, [])
})

test('an inert orphan is separated from one that fires', () => {
  // Both are drift, but only one wakes up at 4am. An operator reading the log
  // needs to know which, and the split mirrors `scheduleToCron` returning null
  // for exactly these two cases.
  const drift = findJobConfigDrift(
    [
      config('long-gone-disabled', { isEnabled: false }),
      config('long-gone-manual', { scheduleType: 'manual' }),
      config('long-gone-daily'),
    ],
    REGISTERED
  )

  assert.equal(drift.orphans.length, 3)
  assert.deepEqual(
    drift.scheduled.map((o) => o.jobName),
    ['long-gone-daily']
  )
})

test('orphans are ordered so two boots produce the same line', () => {
  const drift = findJobConfigDrift(
    [config('zeta-gone'), config('alpha-gone'), config('mid-gone')],
    REGISTERED
  )
  assert.deepEqual(
    drift.orphans.map((o) => o.jobName),
    ['alpha-gone', 'mid-gone', 'zeta-gone']
  )
})

test('an unreadable table is a null, not a throw and not an empty result', () => {
  // Boot must not stop for a diagnostic, and "no orphans" would be a lie about
  // a check that never ran.
  return reportJobConfigDrift(async () => {
    throw new Error('relation "job_config" does not exist')
  }, REGISTERED).then((drift) => assert.equal(drift, null))
})

test('the reporter agrees with the pure comparison it wraps', async () => {
  const configs = [config('generate-recommendations'), config('sync-movies')]
  const drift = await reportJobConfigDrift(async () => configs, REGISTERED)

  assert.deepEqual(drift, findJobConfigDrift(configs, REGISTERED))
})
