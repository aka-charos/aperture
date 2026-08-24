import { test } from 'node:test'
import assert from 'node:assert/strict'

import { EVIDENCE_CAUSAL_MIN_COSINE, hasCausalEvidence } from './evidenceStrength.js'

// The two panels that started this, transcribed from the live instance.
const METROPOLIS_COMPLAINT = [0.67, 0.67, 0.66]
const DANCER_COMPLAINT = [0.6943, 0.694, 0.6928]

// What the same library returns when the lookup is not restricted to one
// viewer's watch history.
const STALKER_GOOD = [0.7884, 0.7429, 0.7398]
const DANCER_GOOD = [0.756, 0.7383, 0.7079]

test('the two panels that prompted this are not called reasons', () => {
  assert.equal(hasCausalEvidence(METROPOLIS_COMPLAINT), false)
  assert.equal(hasCausalEvidence(DANCER_COMPLAINT), false)
})

test('genuinely close evidence still is', () => {
  assert.equal(hasCausalEvidence(STALKER_GOOD), true)
  assert.equal(hasCausalEvidence(DANCER_GOOD), true)
})

test('the best row decides, not the average', () => {
  // Three evidence rows are the top three of one kNN, so the trailing two are
  // bounded by the first and always drag a mean down. Averaging this would
  // read 0.70 and suppress a genuine 0.79 connection.
  const oneStrongTwoFiller = [0.79, 0.66, 0.65]
  assert.equal(hasCausalEvidence(oneStrongTwoFiller), true)
})

test('NUMERIC arrives from pg as a string and must still compare numerically', () => {
  // '0.7500' >= 0.72 is a string/number comparison; the coercion happens to
  // work here and does not for other shapes, so the parse is explicit.
  assert.equal(hasCausalEvidence(['0.7500']), true)
  assert.equal(hasCausalEvidence(['0.6900']), false)
})

test('unparseable or absent values are absent, never zero', () => {
  assert.equal(hasCausalEvidence([]), false)
  assert.equal(hasCausalEvidence([null, undefined]), false)
  assert.equal(hasCausalEvidence(['', 'NaN', 'n/a']), false)
  // An unreadable row must not veto a readable one next to it.
  assert.equal(hasCausalEvidence([null, '0.80']), true)
})

test('the boundary belongs to the causal side', () => {
  assert.equal(hasCausalEvidence([EVIDENCE_CAUSAL_MIN_COSINE]), true)
  assert.equal(hasCausalEvidence([EVIDENCE_CAUSAL_MIN_COSINE - 0.0001]), false)
})

test('the threshold sits between the measured complaint and the measured good match', () => {
  // If someone retunes this, it must still separate the two populations the
  // constant was derived from -- that is the whole claim it makes.
  const worstGood = Math.min(...STALKER_GOOD.slice(0, 1), ...DANCER_GOOD.slice(0, 1))
  const bestComplaint = Math.max(...METROPOLIS_COMPLAINT, ...DANCER_COMPLAINT)
  assert.ok(
    bestComplaint < EVIDENCE_CAUSAL_MIN_COSINE && EVIDENCE_CAUSAL_MIN_COSINE <= worstGood,
    `threshold ${EVIDENCE_CAUSAL_MIN_COSINE} must sit in (${bestComplaint}, ${worstGood}]`
  )
})

test('the caller may override, so a centred-vector rollout can re-derive it', () => {
  assert.equal(hasCausalEvidence([0.55], 0.5), true)
  assert.equal(hasCausalEvidence([0.55], 0.6), false)
})
