import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyPreferenceAdjustment, DEFAULT_PREFERENCE_STRENGTH } from './scoring.js'

const NEUTRAL = { franchise: 0.5, genre: 0.5, interest: 0.5 }
const LOVED = { franchise: 1, genre: 1, interest: 1 }
const HATED = { franchise: 0, genre: 0, interest: 0 }

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
