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
  DEFAULT_GATE_THRESHOLDS,
  RECOMMENDATION_RUNS_TO_KEEP,
  type GateThresholds,
} from './activityGate.js'

const NOW = new Date('2026-08-10T12:00:00Z')

/** Stands in for whatever an admin has configured. */
const T: GateThresholds = { newCandidateThreshold: 12, maxRunAgeDays: 35 }

/** Days before NOW, as a Date. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
}

/**
 * Every signal older than any run the tests use, so "unchanged" is unambiguous.
 * Deliberately older than maxRunAgeDays: a fixture whose signals sat inside the
 * age window made the boundary test pass for the wrong reason.
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
    const decision = decideRegeneration(null, QUIET, T, NOW)
    assert.equal(decision.regenerate, true)
    assert.equal(decision.reason, 'no-previous-run')
  })

  test('skips when every signal predates the last run', () => {
    const decision = decideRegeneration(daysAgo(7), QUIET, T, NOW)
    assert.equal(decision.regenerate, false)
    assert.equal(decision.reason, 'unchanged')
    assert.equal(decision.changedAt, null)
  })

  test('regenerates once the last run passes the maximum age, even if nothing changed', () => {
    const decision = decideRegeneration(daysAgo(T.maxRunAgeDays + 1), QUIET, T, NOW)
    assert.equal(decision.regenerate, true)
    assert.equal(decision.reason, 'max-age')
  })

  test('does not fire the age valve one day early', () => {
    // Boundary matters: firing early would regenerate everyone every run at
    // maxRunAgeDays exactly, quietly undoing the whole optimization.
    const decision = decideRegeneration(daysAgo(T.maxRunAgeDays - 0.5), QUIET, T, NOW)
    assert.equal(decision.regenerate, false)
  })

  test('the age valve follows the configured value, not a baked-in constant', () => {
    // A run 20 days old is stale under a 14-day policy and fresh under a
    // 35-day one. Reading the threshold from the wrong place would make the
    // admin's setting decorative.
    const short = decideRegeneration(daysAgo(20), QUIET, { ...T, maxRunAgeDays: 14 }, NOW)
    const long = decideRegeneration(daysAgo(20), QUIET, { ...T, maxRunAgeDays: 35 }, NOW)
    assert.equal(short.regenerate, true)
    assert.equal(short.reason, 'max-age')
    assert.equal(long.regenerate, false)
  })

  test('a signal newer than the run triggers regeneration and is reported', () => {
    const watched = daysAgo(2)
    const decision = decideRegeneration(daysAgo(7), { ...QUIET, watch_history: watched }, T, NOW)
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
      const decision = decideRegeneration(daysAgo(7), { ...QUIET, [field]: daysAgo(1) }, T, NOW)
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
      { ...QUIET, new_candidate_count: T.newCandidateThreshold - 1 },
      T,
      NOW
    )
    assert.equal(decision.regenerate, false)
  })

  test('a batch of new titles does regenerate', () => {
    const decision = decideRegeneration(
      daysAgo(7),
      { ...QUIET, new_candidate_count: T.newCandidateThreshold },
      T,
      NOW
    )
    assert.equal(decision.regenerate, true)
    assert.equal(decision.reason, 'new-candidates')
  })

  test('the candidate threshold follows the configured value too', () => {
    // Series ships a lower threshold than movies precisely so the same arrival
    // count decides differently for the two media types.
    const signals = { ...QUIET, new_candidate_count: 8 }
    const asMovies = decideRegeneration(daysAgo(7), signals, DEFAULT_GATE_THRESHOLDS.movie, NOW)
    const asSeries = decideRegeneration(daysAgo(7), signals, DEFAULT_GATE_THRESHOLDS.series, NOW)
    assert.equal(asMovies.regenerate, false)
    assert.equal(asSeries.regenerate, true)
    assert.equal(asSeries.reason, 'new-candidates')
  })

  test('a signal exactly equal to the run time is not a change', () => {
    // The run reads its inputs at creation, so an input stamped at the same
    // instant is already reflected in it. Using >= here would make every user
    // whose taste profile rebuilt during their own run regenerate forever.
    const lastRunAt = daysAgo(7)
    const decision = decideRegeneration(lastRunAt, { ...QUIET, taste_profile: lastRunAt }, T, NOW)
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
      T,
      NOW
    )
    assert.equal(decision.regenerate, false)
    assert.equal(decision.reason, 'unchanged')
  })

  test('fails open when the signals could not be read at all', () => {
    const decision = decideRegeneration(daysAgo(7), null, T, NOW)
    assert.equal(decision.regenerate, true)
    assert.equal(decision.reason, 'check-failed')
  })

  test('reports the last run time on every skip-eligible outcome', () => {
    const lastRunAt = daysAgo(7)
    for (const signals of [QUIET, null]) {
      assert.deepEqual(decideRegeneration(lastRunAt, signals, T, NOW).lastRunAt, lastRunAt)
    }
  })
})

describe('gate defaults', () => {
  test('series waits for fewer arrivals than movies', () => {
    // Shows are added far less often than films, so an identical threshold
    // would mean the catalogue signal effectively never fires for series.
    assert.ok(
      DEFAULT_GATE_THRESHOLDS.series.newCandidateThreshold <
        DEFAULT_GATE_THRESHOLDS.movie.newCandidateThreshold
    )
  })

  test('the age valve outlasts a fortnightly schedule', () => {
    // A biweekly job must be able to skip at least one cycle, or the valve
    // fires every time and the gate never saves anything.
    for (const t of Object.values(DEFAULT_GATE_THRESHOLDS)) {
      assert.ok(t.maxRunAgeDays > 28, 'valve must exceed two fortnightly runs')
    }
  })
})

describe('run retention', () => {
  test('keeps more than one run so the history view has something to show', () => {
    assert.ok(RECOMMENDATION_RUNS_TO_KEEP > 1)
  })
})
