import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeDispersion,
  DISPERSION_FOCUSED_THRESHOLD,
  DISPERSION_ECLECTIC_THRESHOLD,
} from './clustering.js'

/**
 * Verbatim copy of the branches that lived inline in
 * lib/tasteAnalyzer.ts's calculateTasteDiversity before the labelling moved
 * next to the cut points it depends on. Same technique as
 * genreAffinity.test.ts: asserting against the original is what makes the
 * extraction provably behavior-preserving rather than merely plausible.
 */
function legacyDescribe(normalizedScore: number): string {
  if (normalizedScore < 0.3) {
    return 'focused'
  } else if (normalizedScore < 0.6) {
    return 'balanced'
  } else {
    return 'eclectic'
  }
}

test('describeDispersion matches the pre-extraction branches across the range', () => {
  for (let score = 0; score <= 1.0001; score += 0.001) {
    const rounded = Math.min(1, Number(score.toFixed(3)))
    assert.equal(
      describeDispersion(rounded),
      legacyDescribe(rounded),
      `mismatch at ${rounded}`
    )
  }
})

test('the boundaries belong to the upper band', () => {
  // Strictly-less-than comparisons, so 0.3 is balanced and 0.6 is eclectic.
  assert.equal(describeDispersion(0.2999), 'focused')
  assert.equal(describeDispersion(DISPERSION_FOCUSED_THRESHOLD), 'balanced')
  assert.equal(describeDispersion(0.5999), 'balanced')
  assert.equal(describeDispersion(DISPERSION_ECLECTIC_THRESHOLD), 'eclectic')
})

test('the ends of the scale are labelled', () => {
  assert.equal(describeDispersion(0), 'focused')
  assert.equal(describeDispersion(1), 'eclectic')
})

test('the cut points are the ones getSmartDiversityWeight keys off', () => {
  // getSmartDiversityWeight applies x0.7 below FOCUSED and x1.2 above ECLECTIC.
  // If these drift, a user labelled "focused" in an AI prompt could be getting
  // the eclectic diversity nudge, which is exactly the split this consolidated.
  assert.equal(DISPERSION_FOCUSED_THRESHOLD, 0.3)
  assert.equal(DISPERSION_ECLECTIC_THRESHOLD, 0.6)
  assert.ok(DISPERSION_FOCUSED_THRESHOLD < DISPERSION_ECLECTIC_THRESHOLD)
})
