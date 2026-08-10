/**
 * Pins the activity gate's decision logic.
 *
 * The gate's whole job is to *not* do work, so a bug here is invisible in the
 * happy path: an inverted comparison would skip everyone forever and the only
 * symptom would be recommendations that quietly never change. These assert the
 * directions and the fail-open behaviour that make that impossible.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideRegeneration,
  MAX_RUN_AGE_DAYS,
  NEW_CANDIDATE_THRESHOLD,
  RECOMMENDATION_RUNS_TO_KEEP,
} from './activityGate.js'

const NOW = new Date('2026-08-10T12:00:00Z')

/** Days before NOW, as a Date. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
}

/**
 * Every signal older than any run the tests use, so "unchanged" is unambiguous.
 * Deliberately older than MAX_RUN_AGE_DAYS: a fixture whose signals sat inside
 * the age window made the boundary test pass for the wrong reason.
 */
const QUIET = {
  watch_history: daysAgo(120),
  ratings: daysAgo(140),
  taste_profile: daysAgo(100),
  preferences: daysAgo(150),
  config: daysAgo(160),
  new_candidate_count: 0,
}

describe('decideRegeneration', () => {
  test('regenerates when the user has never had a run', () => {
    const decision = decideRegeneration(null, QUIET, NOW)
    assert.equal(decision.regenerate, true)
    assert.equal(decision.reason, 'no-previous-run')
  })

  test('skips when every signal predates the last run', () => {
    const decision = decideRegeneration(daysAgo(7), QUIET, NOW)
    assert.equal(decision.regenerate, false)
    assert.equal(decision.reason, 'unchanged')
    assert.equal(decision.changedAt, null)
  })

  test('regenerates once the last run passes the maximum age, even if nothing changed', () => {
    const decision = decideRegeneration(daysAgo(MAX_RUN_AGE_DAYS + 1), QUIET, NOW)
    assert.equal(decision.regenerate, true)
    assert.equal(decision.reason, 'max-age')
  })

  test('does not fire the age valve one day early', () => {
    // Boundary matters: firing early would regenerate everyone every run at
    // MAX_RUN_AGE_DAYS exactly, quietly undoing the whole optimization.
    const decision = decideRegeneration(daysAgo(MAX_RUN_AGE_DAYS - 0.5), QUIET, NOW)
    assert.equal(decision.regenerate, false)
  })

  test('a signal newer than the run triggers regeneration and is reported', () => {
    const watched = daysAgo(2)
    const decision = decideRegeneration(daysAgo(7), { ...QUIET, watch_history: watched }, NOW)
    assert.equal(decision.regenerate, true)
    assert.equal(decision.reason, 'watch-history')
    assert.deepEqual(decision.changedAt, watched)
  })

  test('every other timestamp signal is watched too', () => {
    const cases = [
      ['ratings', 'ratings'],
      ['taste_profile', 'taste-profile'],
      ['preferences', 'preferences'],
      ['config', 'config'],
    ] as const

    for (const [field, reason] of cases) {
      const decision = decideRegeneration(daysAgo(7), { ...QUIET, [field]: daysAgo(1) }, NOW)
      assert.equal(decision.regenerate, true, `${field} should trigger regeneration`)
      assert.equal(decision.reason, reason)
    }
  })

  test('a trickle of new titles is not enough to regenerate everybody', () => {
    // The catalogue is a global signal: if one new film forced a rebuild, every
    // user on an instance that acquires content weekly would regenerate every
    // run and the gate would never once fire.
    const decision = decideRegeneration(
      daysAgo(7),
      { ...QUIET, new_candidate_count: NEW_CANDIDATE_THRESHOLD - 1 },
      NOW
    )
    assert.equal(decision.regenerate, false)
  })

  test('a batch of new titles does regenerate', () => {
    const decision = decideRegeneration(
      daysAgo(7),
      { ...QUIET, new_candidate_count: NEW_CANDIDATE_THRESHOLD },
      NOW
    )
    assert.equal(decision.regenerate, true)
    assert.equal(decision.reason, 'new-candidates')
  })

  test('a signal exactly equal to the run time is not a change', () => {
    // The run reads its inputs at creation, so an input stamped at the same
    // instant is already reflected in it. Using >= here would make every user
    // whose taste profile rebuilt during their own run regenerate forever.
    const lastRunAt = daysAgo(7)
    const decision = decideRegeneration(lastRunAt, { ...QUIET, taste_profile: lastRunAt }, NOW)
    assert.equal(decision.regenerate, false)
  })

  test('null signals mean "no such row", not "changed"', () => {
    const decision = decideRegeneration(
      daysAgo(7),
      {
        watch_history: null,
        ratings: null,
        taste_profile: null,
        preferences: null,
        config: null,
        new_candidate_count: 0,
      },
      NOW
    )
    assert.equal(decision.regenerate, false)
    assert.equal(decision.reason, 'unchanged')
  })

  test('fails open when the signals could not be read at all', () => {
    const decision = decideRegeneration(daysAgo(7), null, NOW)
    assert.equal(decision.regenerate, true)
    assert.equal(decision.reason, 'check-failed')
  })

  test('reports the last run time on every skip-eligible outcome', () => {
    const lastRunAt = daysAgo(7)
    for (const signals of [QUIET, null]) {
      assert.deepEqual(decideRegeneration(lastRunAt, signals, NOW).lastRunAt, lastRunAt)
    }
  })
})

describe('run retention', () => {
  test('keeps more than one run so the history view has something to show', () => {
    assert.ok(RECOMMENDATION_RUNS_TO_KEEP > 1)
  })
})
