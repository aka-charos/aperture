import test from 'node:test'
import assert from 'node:assert/strict'
import { adjustDiversityWeightForDispersion } from './userAlgorithmSettings.js'
import {
  DISPERSION_FOCUSED_THRESHOLD,
  DISPERSION_ECLECTIC_THRESHOLD,
} from '../taste-profile/clustering.js'

const BASE = 0.2

// ============================================================================
// The bug this function exists to prevent
// ============================================================================

test('a saturated score is treated as no signal, not as focused taste', () => {
  // Every one of 14 real profiles scored exactly 0.000, because the raw cosine
  // distance (0.238-0.254) sits entirely below the 0.3 floor of the window the
  // score is rescaled from. Reading that as "focused" handed a x0.7 reduction
  // to the entire user base on the strength of a clamp.
  assert.equal(adjustDiversityWeightForDispersion(BASE, 0), BASE)
  assert.equal(adjustDiversityWeightForDispersion(BASE, 1), BASE)
})

test('a saturated score never reaches the focused branch, at any base weight', () => {
  for (const base of [0, 0.05, 0.2, 0.5, 0.9, 1]) {
    assert.equal(
      adjustDiversityWeightForDispersion(base, 0),
      Math.max(0, Math.min(1, base)),
      `base ${base} was adjusted from a saturated score`
    )
  }
})

test('a non-finite score is also treated as no signal', () => {
  assert.equal(adjustDiversityWeightForDispersion(BASE, NaN), BASE)
  assert.equal(adjustDiversityWeightForDispersion(BASE, Infinity), BASE)
  assert.equal(adjustDiversityWeightForDispersion(BASE, -Infinity), BASE)
})

// ============================================================================
// The adjustment itself, for when the measurement can discriminate again
// ============================================================================

test('an unsaturated focused score still reduces the weight', () => {
  const focused = DISPERSION_FOCUSED_THRESHOLD / 2
  assert.ok(focused > 0 && focused < DISPERSION_FOCUSED_THRESHOLD)
  assert.ok(Math.abs(adjustDiversityWeightForDispersion(BASE, focused) - BASE * 0.7) < 1e-12)
})

test('an eclectic score still raises the weight', () => {
  const eclectic = (DISPERSION_ECLECTIC_THRESHOLD + 1) / 2
  assert.ok(eclectic > DISPERSION_ECLECTIC_THRESHOLD && eclectic < 1)
  assert.ok(Math.abs(adjustDiversityWeightForDispersion(BASE, eclectic) - BASE * 1.2) < 1e-12)
})

test('a middling score leaves the weight alone', () => {
  const middle = (DISPERSION_FOCUSED_THRESHOLD + DISPERSION_ECLECTIC_THRESHOLD) / 2
  assert.equal(adjustDiversityWeightForDispersion(BASE, middle), BASE)
})

test('the band boundaries themselves do not adjust', () => {
  // Branches are strict (< FOCUSED, > ECLECTIC), so the cut points are neutral.
  assert.equal(adjustDiversityWeightForDispersion(BASE, DISPERSION_FOCUSED_THRESHOLD), BASE)
  assert.equal(adjustDiversityWeightForDispersion(BASE, DISPERSION_ECLECTIC_THRESHOLD), BASE)
})

// ============================================================================
// The invariant selectWithMmr depends on
// ============================================================================

test('the result is always a usable weight in [0,1]', () => {
  // selectWithMmr blends as (1-w)*relevance - w*gain*redundancy: above 1 the
  // relevance term goes negative, below 0 the penalty becomes a bonus, and the
  // 1.2x bump can push a high base past 1.
  for (const base of [0, 0.5, 0.9, 0.95, 1, 2, -1]) {
    for (const dispersion of [-1, 0, 0.1, 0.45, 0.8, 1, 2, NaN]) {
      const result = adjustDiversityWeightForDispersion(base, dispersion)
      assert.ok(
        Number.isFinite(result) && result >= 0 && result <= 1,
        `base=${base} dispersion=${dispersion} produced ${result}`
      )
    }
  }
})

test('a high base weight cannot be pushed past 1 by the eclectic bump', () => {
  const eclectic = (DISPERSION_ECLECTIC_THRESHOLD + 1) / 2
  assert.equal(adjustDiversityWeightForDispersion(0.95, eclectic), 1)
})
