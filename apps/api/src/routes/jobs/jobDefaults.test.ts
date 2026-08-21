/**
 * The job catalogue and its schedule defaults live in different packages, and
 * nothing but this test can see them both.
 *
 * `definitions.ts` (apps/api) is the registry of what a job IS.
 * `JOB_SCHEDULE_DEFAULTS` (packages/core) is a seed cadence for a job with no
 * `job_config` row yet. Core cannot import the API app, so TypeScript can never
 * check one against the other -- the same shape as the AI-role enums copied
 * across ten route schemas, and it failed the same way.
 *
 * What it cost: `getValidJobNames()` returned the keys of the defaults map, and
 * the schedule route used that to decide whether a job existed. Four jobs were
 * registered correctly in `definitions.ts`, the executor switch, `JOB_CATEGORIES`
 * and (for two of them) a migration, and still answered 404 "Job not found" on
 * both GET and PATCH of their schedule. The dialog opened on its own defaults,
 * so it looked configurable right up to pressing Save.
 *
 * The route now validates against the catalogue, which removes the 404 for good.
 * These assertions cover what remains: a scheduled job whose default nobody
 * wrote, and a default for a job that no longer exists.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { JOB_SCHEDULE_DEFAULTS } from '@aperture/core'
import { jobDefinitions } from './definitions.js'

const definedNames = new Set(jobDefinitions.map((j) => j.name))
const defaultNames = new Set(Object.keys(JOB_SCHEDULE_DEFAULTS))

test('every registered job has a seed schedule', () => {
  // Without one, a job with no job_config row is manual-only forever: the
  // scheduler builds its task list from getAllJobConfigs(), which merges rows
  // with this map and knows nothing about the `cron` field in definitions.ts.
  const missing = jobDefinitions.map((j) => j.name).filter((name) => !defaultNames.has(name))
  assert.deepEqual(
    missing,
    [],
    `Jobs registered in definitions.ts with no entry in JOB_SCHEDULE_DEFAULTS: ${missing.join(', ')}`
  )
})

test('no seed schedule names a job that does not exist', () => {
  // A leftover default is dead weight that getAllJobConfigs() still returns, so
  // the scheduler would try to register a task for a job the executor cannot run.
  const orphans = [...defaultNames].filter((name) => !definedNames.has(name))
  assert.deepEqual(
    orphans,
    [],
    `JOB_SCHEDULE_DEFAULTS entries with no job in definitions.ts: ${orphans.join(', ')}`
  )
})

test('a manual-only job is seeded as manual', () => {
  // Otherwise a job the UI refuses to schedule acquires a cadence anyway, and
  // the scheduler is the one that wins -- `manualOnly` is a client-side flag.
  const wrong = jobDefinitions
    .filter((j) => j.manualOnly)
    .filter((j) => JOB_SCHEDULE_DEFAULTS[j.name]?.scheduleType !== 'manual')
    .map((j) => j.name)
  assert.deepEqual(wrong, [], `manualOnly jobs seeded with a real schedule: ${wrong.join(', ')}`)
})
