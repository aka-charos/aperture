import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BENCHMARK_PAIRS,
  BENCHMARK_RUNS_PER_PAIR,
  creditsRuleVerdict,
  modelVerdict,
  scoreBenchmark,
  thresholdVerdict,
  type BenchmarkPairResult,
} from './evidenceBenchmarkPairs.js'
import { EVIDENCE_CAUSAL_MIN_COSINE } from './evidenceStrength.js'

const pair = (id: string) => {
  const found = BENCHMARK_PAIRS.find((p) => p.id === id)
  assert.ok(found, `pair ${id} exists`)
  return found
}

// ------------------------------------------------------------------ the labels

test('the label set is pinned: editing a label changes what the benchmark measures', () => {
  const count = (label: string) => BENCHMARK_PAIRS.filter((p) => p.label === label).length
  assert.equal(BENCHMARK_PAIRS.length, 31)
  assert.equal(count('yes'), 18)
  assert.equal(count('no'), 11)
  assert.equal(count('arguable'), 2)
})

test('Top Gun: Maverick against Dead Reckoning is arguable, on the operator call', () => {
  const topGun = pair('top-gun-maverick-dead-reckoning')
  assert.equal(topGun.label, 'arguable')
  assert.equal(topGun.reason.kind, 'arguableStar')
})

test('a shared actor alone is labelled no, per the operator rule', () => {
  const spiderMan = pair('spider-man-no-way-home-uncharted')
  assert.equal(spiderMan.label, 'no')
  assert.equal(spiderMan.reason.kind, 'actorOnly')
})

test('the pairs no threshold can sort are all in the set, as yes', () => {
  for (const id of ['die-hard-live-free-or-die-hard', 'decalogue-veronique', 'paris-texas-perfect-days']) {
    assert.equal(pair(id).label, 'yes')
  }
})

test('every pair is well formed', () => {
  const ids = new Set<string>()
  for (const p of BENCHMARK_PAIRS) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`)
    ids.add(p.id)
    assert.ok(p.pick.length > 0 && p.watched.length > 0, `${p.id} has candidates on both sides`)
    for (const c of [...p.pick, ...p.watched]) {
      assert.ok(c.title.trim(), `${p.id} has no blank title`)
      assert.ok(c.year > 1880 && c.year < 2100, `${p.id} has a plausible year`)
    }
    // A pair is two different films.
    assert.notEqual(p.pick[0].title, p.watched[0].title)
    // Arguable and labelled reasons must agree about what kind of pair it is.
    const arguableKind = p.reason.kind.startsWith('arguable')
    assert.equal(p.label === 'arguable', arguableKind, `${p.id} label and reason agree`)
  }
})

test('the films the label depends on are pinned by year, not by title alone', () => {
  // "Dune" must be Villeneuve's and "Solaris" Tarkovsky's: a remake with the
  // same title would quietly measure a different pair.
  assert.equal(pair('dune-part-two-dune').watched[0].year, 2021)
  assert.equal(pair('stalker-solaris').watched[0].year, 1972)
})

// -------------------------------------------------------------- the verdicts

test('each pair is asked twice, so noise can be told from a difference', () => {
  assert.equal(BENCHMARK_RUNS_PER_PAIR, 2)
})

test('the model call is the mean of its runs, and runs on both sides are unstable', () => {
  assert.deepEqual(modelVerdict([0.9, 0.8]), { says: true, unstable: false })
  assert.deepEqual(modelVerdict([0.1, 0.2]), { says: false, unstable: false })
  assert.deepEqual(modelVerdict([0.45, 0.6]), { says: true, unstable: true })
  assert.deepEqual(modelVerdict([]), { says: null, unstable: false })
})

test('the threshold call is the panel own bar', () => {
  assert.equal(thresholdVerdict(EVIDENCE_CAUSAL_MIN_COSINE), true)
  assert.equal(thresholdVerdict(EVIDENCE_CAUSAL_MIN_COSINE - 0.001), false)
  assert.equal(thresholdVerdict(null), null)
})

// ----------------------------------------------------------------- the score

function result(over: Partial<BenchmarkPairResult>): BenchmarkPairResult {
  return {
    id: 'x',
    label: 'yes',
    reason: { kind: 'sameDirector' },
    pickTitle: 'P',
    watchedTitle: 'W',
    status: 'scored',
    missing: [],
    similarity: 0.8,
    thresholdSays: true,
    modelRuns: [0.9, 0.9],
    modelSays: true,
    unstable: false,
    ruleSays: true,
    ruleBasis: 'director',
    ...over,
  }
}

test('all three sides are scored on exactly the same pairs', () => {
  const score = scoreBenchmark([
    // All right.
    result({}),
    // Die Hard: threshold wrong (under the bar), model right — a fix.
    result({ similarity: 0.68, thresholdSays: false }),
    // Children of Men: label no, threshold wrong, model wrong — neither.
    result({ label: 'no', reason: { kind: 'looseOnly' }, ruleSays: false, ruleBasis: null }),
    // Label no, threshold right, model wrong — a break.
    result({
      label: 'no',
      reason: { kind: 'looseOnly' },
      thresholdSays: false,
      ruleSays: false,
      ruleBasis: null,
    }),
    // No embedding: the threshold has no answer, so nothing else is counted either.
    result({ similarity: null, thresholdSays: null }),
    // The model failed: nothing counted.
    result({ status: 'failed', modelRuns: [], modelSays: null }),
    // The rule could not be computed: nothing counted.
    result({ ruleSays: null, ruleBasis: null }),
    // Arguable: shown, never scored, whatever any side says.
    result({ label: 'arguable', reason: { kind: 'arguableStar' } }),
    // Not in the library.
    result({ status: 'notInLibrary', thresholdSays: null, modelSays: null, modelRuns: [] }),
  ])
  assert.equal(score.scored, 4)
  assert.equal(score.thresholdRight, 2)
  assert.equal(score.ruleRight, 4)
  assert.equal(score.modelRight, 2)
  assert.equal(score.modelFixed, 1)
  assert.equal(score.modelBroke, 1)
  assert.equal(score.modelBeatRule, 0)
  assert.equal(score.ruleBeatModel, 2)
  assert.equal(score.arguable, 1)
  assert.equal(score.failed, 1)
  assert.equal(score.notInLibrary, 1)
})

test('the no-shared-credits subtotal counts only pairs the rule could not link', () => {
  const score = scoreBenchmark([
    // Same director: in the total, not in the subtotal.
    result({}),
    // Nobody <- John Wick: a reason with no shared credit. Rule says no, model yes.
    result({ ruleSays: false, ruleBasis: null }),
    // Deadpool & Wolverine <- Dune: Part Two: not a reason, no shared credit.
    result({ label: 'no', reason: { kind: 'looseOnly' }, ruleSays: false, ruleBasis: null, modelSays: false }),
  ])
  assert.deepEqual(score.noSharedCredits, { scored: 2, thresholdRight: 1, ruleRight: 1, modelRight: 2 })
  assert.equal(score.modelBeatRule, 1)
})

// -------------------------------------------------------------- the credits rule

test('a shared director is a reason, matched without regard to case or accents', () => {
  const verdict = creditsRuleVerdict(
    { creators: ['Krzysztof Kieślowski'] },
    { creators: ['krzysztof kieslowski'] }
  )
  assert.deepEqual(verdict, { says: true, basis: 'director' })
})

test('a shared franchise is a reason', () => {
  assert.deepEqual(
    creditsRuleVerdict(
      { creators: ['George Miller'], franchise: 'Mad Max Collection' },
      { creators: ['Someone Else'], franchise: 'mad max collection' }
    ),
    { says: true, basis: 'franchise' }
  )
})

test('nothing shared, or nothing recorded, is not a reason', () => {
  assert.deepEqual(
    creditsRuleVerdict({ creators: ['Ilya Naishuller'] }, { creators: ['Chad Stahelski'] }),
    { says: false, basis: null }
  )
  // Missing data cannot match — two absent franchises are not "the same franchise".
  assert.deepEqual(
    creditsRuleVerdict({ creators: [], franchise: null }, { creators: [''], franchise: '' }),
    { says: false, basis: null }
  )
})

test('an unstable pair is counted as unstable and still scored on its mean', () => {
  const score = scoreBenchmark([result({ modelRuns: [0.45, 0.6], modelSays: true, unstable: true })])
  assert.equal(score.unstable, 1)
  assert.equal(score.scored, 1)
  assert.equal(score.modelRight, 1)
})
