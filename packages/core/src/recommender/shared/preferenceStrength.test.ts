import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPreferenceAdjustment,
  DEFAULT_PREFERENCE_DIMENSION_WEIGHTS,
  DEFAULT_PREFERENCE_STRENGTH,
} from './scoring.js'

const NEUTRAL = { franchise: 0.5, genre: 0.5, interest: 0.5, era: 0.5 }
const LOVED = { franchise: 1, genre: 1, interest: 1, era: 1 }
const HATED = { franchise: 0, genre: 0, interest: 0, era: 0 }

/** The three dimensions that existed before era, at their original weights. */
const PRE_ERA_WEIGHTS = { franchise: 0.5, genre: 0.5, interest: 0.3, era: 0 }

test('a neutral signal never moves the score, at any strength', () => {
  for (const s of [0, 0.25, DEFAULT_PREFERENCE_STRENGTH, 1]) {
    assert.equal(applyPreferenceAdjustment(0.6, NEUTRAL, s), 0.6)
  }
})

test('strength 0 switches the nudge off entirely', () => {
  assert.equal(applyPreferenceAdjustment(0.6, LOVED, 0), 0.6)
  assert.equal(applyPreferenceAdjustment(0.6, HATED, 0), 0.6)
})

test('the default reproduces the behaviour that was hardcoded', () => {
  // 0.60 with a maxed signal closes half the remaining 0.40 gap.
  assert.equal(applyPreferenceAdjustment(0.6, LOVED, DEFAULT_PREFERENCE_STRENGTH).toFixed(4), '0.8000')
  // Omitting the argument must be identical, or every existing caller changes.
  assert.equal(applyPreferenceAdjustment(0.6, LOVED), applyPreferenceAdjustment(0.6, LOVED, 0.5))
})

test('strength scales the move proportionally', () => {
  assert.equal(applyPreferenceAdjustment(0.6, LOVED, 0.25).toFixed(4), '0.7000')
  assert.equal(applyPreferenceAdjustment(0.6, LOVED, 1).toFixed(4), '1.0000')
})

test('a disliked title is pulled toward 0 by the same share', () => {
  assert.equal(applyPreferenceAdjustment(0.6, HATED, 0.5).toFixed(4), '0.3000')
  assert.equal(applyPreferenceAdjustment(0.6, HATED, 0).toFixed(4), '0.6000')
})

test('the result can never leave [0,1] however strong the nudge', () => {
  for (const q of [0, 0.01, 0.5, 0.99, 1]) {
    for (const a of [LOVED, HATED, NEUTRAL]) {
      const out = applyPreferenceAdjustment(q, a, 1)
      assert.ok(out >= 0 && out <= 1, `${q} -> ${out}`)
    }
  }
})

test('a nonsense strength falls back rather than inverting the nudge', () => {
  // A negative share would push a loved title DOWN, which is worse than
  // ignoring the setting.
  const good = applyPreferenceAdjustment(0.6, LOVED, DEFAULT_PREFERENCE_STRENGTH)
  assert.equal(applyPreferenceAdjustment(0.6, LOVED, NaN), good)
  assert.equal(applyPreferenceAdjustment(0.6, LOVED, -1), 0.6, 'clamped to off, not inverted')
  assert.equal(applyPreferenceAdjustment(0.6, LOVED, 5).toFixed(4), '1.0000', 'clamped to full')
})

test('era ships off, and off means byte-identical to before it existed', () => {
  // The point of normalising by the SUPPLIED total rather than a module
  // constant. A dimension weighted 0 must not attenuate the other three -- they
  // have to divide by 1.3 exactly as they always did, or shipping this feature
  // switched off would still have moved everybody's scores.
  assert.equal(DEFAULT_PREFERENCE_DIMENSION_WEIGHTS.era, 0, 'ships off')

  for (const q of [0.1, 0.35, 0.6, 0.9]) {
    for (const affinities of [LOVED, HATED, { franchise: 0.8, genre: 0.2, interest: 0.5, era: 0.5 }]) {
      assert.equal(
        applyPreferenceAdjustment(q, affinities, 0.5, PRE_ERA_WEIGHTS),
        applyPreferenceAdjustment(q, affinities, 0.5),
        `default weights must equal era-off weights at q=${q}`
      )
    }
  }
})

test('an era affinity cannot move a score while era is switched off', () => {
  const sought = { franchise: 0.5, genre: 0.5, interest: 0.5, era: 1 }
  const avoided = { franchise: 0.5, genre: 0.5, interest: 0.5, era: 0 }

  assert.equal(applyPreferenceAdjustment(0.6, sought, 0.5, PRE_ERA_WEIGHTS), 0.6)
  assert.equal(applyPreferenceAdjustment(0.6, avoided, 0.5, PRE_ERA_WEIGHTS), 0.6)
})

test('once weighted, era pulls in both directions and stays bounded', () => {
  const on = { franchise: 0.5, genre: 0.5, interest: 0.3, era: 0.5 }
  const sought = { franchise: 0.5, genre: 0.5, interest: 0.5, era: 0.77 }
  const avoided = { franchise: 0.5, genre: 0.5, interest: 0.5, era: 0.17 }

  assert.ok(applyPreferenceAdjustment(0.6, sought, 0.5, on) > 0.6, 'a sought decade lifts')
  assert.ok(applyPreferenceAdjustment(0.6, avoided, 0.5, on) < 0.6, 'an avoided decade sinks')

  for (const q of [0, 0.5, 1]) {
    for (const a of [LOVED, HATED, sought, avoided]) {
      const out = applyPreferenceAdjustment(q, a, 1, on)
      assert.ok(out >= 0 && out <= 1, `${q} -> ${out}`)
    }
  }
})

test('era at full strength still cannot outvote content fit on its own', () => {
  // The whole reason this is a nudge rather than a score term: a decade the
  // viewer loves must not manufacture a match out of a poor one.
  const eraOnly = { franchise: 0.5, genre: 0.5, interest: 0.5, era: 1 }
  const heavy = { franchise: 0.5, genre: 0.5, interest: 0.3, era: 2 }

  const out = applyPreferenceAdjustment(0.2, eraOnly, 1, heavy)
  assert.ok(out < 0.75, `a 0.2 content fit should stay poor, got ${out}`)
})

test('all-zero weights leave the score alone rather than dividing by zero', () => {
  const none = { franchise: 0, genre: 0, interest: 0, era: 0 }
  assert.equal(applyPreferenceAdjustment(0.6, LOVED, 0.5, none), 0.6)
  assert.ok(Number.isFinite(applyPreferenceAdjustment(0.6, HATED, 1, none)))
})
