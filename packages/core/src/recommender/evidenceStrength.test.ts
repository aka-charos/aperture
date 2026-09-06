import { test } from 'node:test'
import assert from 'node:assert/strict'

import { EVIDENCE_CAUSAL_MIN_COSINE, hasCausalEvidence } from './evidenceStrength.js'
import { compareEvidenceThresholdSet } from './evidenceThresholdProvenance.js'

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

// ---------------------------------------------------------------------------
// Second derivation: openrouter:google/gemini-embedding-2 @3072, raw cosine,
// measured over 581 picks. Pinned separately from the first because the two
// were measured on DIFFERENT MODELS and a retune has to satisfy both -- that
// is the whole point of keeping the earlier anchors around.
// ---------------------------------------------------------------------------

/** Rejected at 0.72 and nobody would call any of them weak. */
const GEMINI2_KEEP = [
  ['Furiosa -> Mad Max', 0.717],
  ['Top Gun: Maverick -> M:I Dead Reckoning', 0.713],
  ['Mulholland Drive -> Blue Velvet', 0.711],
  ['Blade Runner 2049 -> Dune: Part Two', 0.711],
  ['Nobody -> John Wick', 0.709],
  ['The Irishman -> Gangs of New York', 0.707],
] as const

/** The band where "both are films released recently" starts winning. */
const GEMINI2_DROP = [
  ['The Batman -> M:I Dead Reckoning', 0.69],
  ['Coco -> Finding Dory', 0.69],
  ['One Battle After Another -> A Working Man', 0.689],
  ['Thirteen Lives -> Gran Turismo', 0.681],
  ['Marriage Story -> Poor Things', 0.673],
] as const

test('same-director and same-franchise pairs are called reasons', () => {
  for (const [pair, sim] of GEMINI2_KEEP) {
    assert.equal(hasCausalEvidence([sim]), true, `${pair} (${sim}) should be causal`)
  }
})

test('coincidence-of-release-year pairs are not', () => {
  for (const [pair, sim] of GEMINI2_DROP) {
    assert.equal(hasCausalEvidence([sim]), false, `${pair} (${sim}) should not be causal`)
  }
})

test('the threshold sits in the gap, not inside a cluster', () => {
  // 0.691-0.703 is empty in the measured distribution. Landing the bar inside a
  // cluster is what produced the contradiction that prompted the re-derivation:
  // The Martian -> Prometheus passed at 0.722 while Gravity -> Prometheus
  // failed at 0.715, on identical reasoning 0.007 apart.
  assert.ok(
    EVIDENCE_CAUSAL_MIN_COSINE > 0.691 && EVIDENCE_CAUSAL_MIN_COSINE <= 0.703,
    `threshold ${EVIDENCE_CAUSAL_MIN_COSINE} must sit in the measured gap (0.691, 0.703]`
  )
})

test('a strong pair below the bar is a known limit, not a bug to tune away', () => {
  // Die Hard -> Live Free or Die Hard 0.680, Decalogue I -> Veronique 0.672,
  // Paris Texas -> Perfect Days 0.658. Any bar rejecting Marriage Story ->
  // Poor Things at 0.673 rejects two of these, so no value gets them all.
  // Asserted so a future retune notices it is trading one for the other.
  assert.equal(hasCausalEvidence([0.68]), false, 'Die Hard -> Live Free or Die Hard')
  assert.equal(hasCausalEvidence([0.658]), false, 'Paris, Texas -> Perfect Days')
})

test('the threshold records which embedding set it was measured on', () => {
  assert.deepEqual(compareEvidenceThresholdSet('openrouter:google/gemini-embedding-2'), {
    state: 'match',
    activeSet: 'openrouter:google/gemini-embedding-2',
  })

  // The swap that invalidated the first derivation, which nothing noticed.
  assert.equal(
    compareEvidenceThresholdSet('openrouter:google/gemini-embedding-001').state,
    'diverged'
  )

  // A mode suffix is a different space and therefore a different distribution.
  assert.equal(
    compareEvidenceThresholdSet('openrouter:google/gemini-embedding-2~semantic_similarity').state,
    'diverged'
  )
})

test('an unconfigured instance has nothing to disagree with', () => {
  // Every instance before setup finishes. Reporting a mismatch here would put a
  // warning about embedding distributions in front of someone who has not yet
  // chosen a model.
  assert.equal(compareEvidenceThresholdSet(null).state, 'unknown')
  assert.equal(compareEvidenceThresholdSet(undefined).state, 'unknown')
  assert.equal(compareEvidenceThresholdSet('   ').state, 'unknown')
})
