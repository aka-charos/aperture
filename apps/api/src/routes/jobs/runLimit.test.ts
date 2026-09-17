import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_MAX_TITLES_PER_RUN } from '@aperture/core'

import { jobDefinitions } from './definitions.js'
import { resolveRunLimit, runLimitError } from './runLimit.js'
import type { JobRunLimit } from './types.js'

const LIMIT: JobRunLimit = { default: 200, min: 1, max: 5000, unit: 'titles' }

test('an unset cap reads as the declared default', () => {
  assert.equal(resolveRunLimit(LIMIT, null), 200)
  assert.equal(resolveRunLimit(LIMIT, undefined), 200)
})

test('a stored cap inside the range is used as-is, including the bounds', () => {
  assert.equal(resolveRunLimit(LIMIT, 1), 1)
  assert.equal(resolveRunLimit(LIMIT, 25), 25)
  assert.equal(resolveRunLimit(LIMIT, 5000), 5000)
})

test('a stored cap outside the range reads as unset, never clamped', () => {
  // The range can move between builds; a value that is no longer valid is not
  // one the operator chose in its clamped form either.
  assert.equal(resolveRunLimit(LIMIT, 5001), 200)
  assert.equal(resolveRunLimit(LIMIT, 0), 200)
  assert.equal(resolveRunLimit(LIMIT, 2.5), 200)
})

test('clearing the cap is always accepted for a job that declares one', () => {
  assert.equal(runLimitError(LIMIT, null), null)
})

test('a job with no declared limit refuses a number but accepts a clear', () => {
  assert.equal(runLimitError(undefined, null), null)
  assert.notEqual(runLimitError(undefined, 10), null)
})

test('out-of-range and fractional caps are refused', () => {
  assert.notEqual(runLimitError(LIMIT, 0), null)
  assert.notEqual(runLimitError(LIMIT, -3), null)
  assert.notEqual(runLimitError(LIMIT, 5001), null)
  assert.notEqual(runLimitError(LIMIT, 1.5), null)
  assert.equal(runLimitError(LIMIT, 1), null)
  assert.equal(runLimitError(LIMIT, 5000), null)
})

test('every declared limit is internally consistent', () => {
  for (const def of jobDefinitions) {
    const limit = def.runLimit
    if (!limit) continue
    assert.ok(Number.isInteger(limit.min) && limit.min >= 1, `${def.name}: min must be a positive integer`)
    assert.ok(limit.max >= limit.min, `${def.name}: max below min`)
    assert.ok(
      limit.default >= limit.min && limit.default <= limit.max,
      `${def.name}: default outside its own range`
    )
  }
})

test('title analysis is schedulable and its default is the core constant', () => {
  const def = jobDefinitions.find((j) => j.name === 'generate-title-analysis')
  assert.ok(def, 'generate-title-analysis is registered')
  assert.notEqual(def.manualOnly, true)
  assert.equal(def.runLimit?.default, DEFAULT_MAX_TITLES_PER_RUN)
})
