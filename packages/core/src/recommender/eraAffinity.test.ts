import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEraAffinities,
  eraAffinityEntry,
  eraAffinityFor,
  foldYearsToDecades,
  liftToAffinity,
  summarizeEraAffinities,
  ERA_AFFINITY_FLOOR,
  ERA_PSEUDO_COUNT,
  type DecadeCounts,
} from './eraAffinity.js'

/**
 * The live library this feature was designed against: 12,589 films, measured
 * 2026-08-27. Kept exact because the whole argument for smoothing rests on the
 * spread between a decade holding one film and a decade holding 497.
 */
const LIBRARY: DecadeCounts = new Map([
  [1900, 1],
  [1910, 2],
  [1920, 46],
  [1930, 139],
  [1940, 238],
  [1950, 497],
  [1960, 691],
  [1970, 851],
  [1980, 992],
  [1990, 1265],
  [2000, 2058],
  [2010, 3851],
  [2020, 1958],
])

/** Viewer "goca": 198 films, a clean recency ramp. */
const RECENCY_VIEWER: DecadeCounts = new Map([
  [1960, 1],
  [1970, 5],
  [1980, 10],
  [1990, 18],
  [2000, 31],
  [2010, 53],
  [2020, 80],
])

/**
 * Viewer "k1a": 1,563 films -- five times the median history on that instance,
 * and the least noisy profile available. Counts reconstructed from the measured
 * lifts, which is why the assertions below test the SHAPE rather than exact
 * values. The shape is the part that matters: this viewer peaks at the 2000s
 * and sits below neutral on the 2020s.
 */
const MID_ERA_VIEWER: DecadeCounts = new Map([
  [1930, 20],
  [1940, 14],
  [1950, 43],
  [1960, 77],
  [1970, 105],
  [1980, 137],
  [1990, 214],
  [2000, 375],
  [2010, 362],
  [2020, 216],
])

const round2 = (n: number) => Math.round(n * 100) / 100

test('reproduces the measured profile of a real viewer', () => {
  const index = buildEraAffinities(RECENCY_VIEWER, LIBRARY)

  // Hand-verified against the live query output. Any change to the smoothing
  // arithmetic has to be a deliberate one that updates this table.
  const expected: Record<number, number> = {
    1900: 1.0,
    1910: 0.99,
    1920: 0.87,
    1930: 0.7,
    1940: 0.57,
    1950: 0.39,
    1960: 0.38,
    1970: 0.54,
    1980: 0.73,
    1990: 0.92,
    2000: 0.96,
    2010: 0.88,
    2020: 2.37,
  }

  for (const [decade, lift] of Object.entries(expected)) {
    const entry = index.get(Number(decade))
    assert.ok(entry, `missing decade ${decade}`)
    assert.equal(round2(entry.lift), lift, `decade ${decade}`)
  }
})

test('two identical zeroes read as opposite things', () => {
  // The central claim. This viewer has watched nothing from either decade, but
  // the 1900s hold one film (no evidence) and the 1950s hold 497 (overwhelming
  // evidence -- p ~ 3e-7 of drawing none across 198 films).
  const index = buildEraAffinities(RECENCY_VIEWER, LIBRARY)

  const noEvidence = index.get(1900)!
  const realAvoidance = index.get(1950)!

  assert.equal(noEvidence.watched, 0)
  assert.equal(realAvoidance.watched, 0)

  assert.ok(noEvidence.lift > 0.95, `one-film decade should read neutral, got ${noEvidence.lift}`)
  assert.ok(
    realAvoidance.lift < 0.45,
    `497-film decade should read as avoidance, got ${realAvoidance.lift}`
  )
})

test('raw lift cannot make that distinction, which is why smoothing is not cosmetic', () => {
  const raw = buildEraAffinities(RECENCY_VIEWER, LIBRARY, { pseudoCount: 0, floor: 0 })
  assert.equal(raw.get(1900)!.lift, 0)
  assert.equal(raw.get(1950)!.lift, 0)
})

test('a thin history collapses toward neutral without a separate gate', () => {
  const index = buildEraAffinities(new Map([[2020, 3]]), LIBRARY)

  for (const entry of index.values()) {
    assert.ok(
      Math.abs(entry.lift - 1) < 0.5,
      `decade ${entry.decade} should be near neutral on 3 films, got ${entry.lift}`
    )
  }
})

test('but a small history that is entirely one decade still registers', () => {
  // Ten for ten against a 15.6% slice is p ~ 1e-8 under the null. Smoothing has
  // to be asymmetric in this direction or it would mute genuine signal in new
  // viewers, who are exactly the ones with the sharpest era preferences.
  const index = buildEraAffinities(new Map([[2020, 10]]), LIBRARY)
  assert.ok(index.get(2020)!.lift > 2, `expected a real seek signal, got ${index.get(2020)!.lift}`)
})

test('shapes differ between viewers, so a recency curve would be wrong', () => {
  // The finding that settled the design. A two-parameter recency model fits the
  // ramp viewer well and is actively wrong for this one.
  const ramp = buildEraAffinities(RECENCY_VIEWER, LIBRARY)
  const midEra = buildEraAffinities(MID_ERA_VIEWER, LIBRARY)

  assert.ok(ramp.get(2020)!.lift > ramp.get(2000)!.lift, 'ramp viewer peaks most recently')
  assert.ok(midEra.get(2000)!.lift > midEra.get(2020)!.lift, 'mid-era viewer does not')
  assert.ok(midEra.get(2000)!.lift > 1, 'and genuinely seeks the 2000s')
  assert.ok(midEra.get(2020)!.lift < 1, 'while genuinely avoiding the 2020s')
})

test('the affinity map fixes neutral at 0.5 and is symmetric in the ratio', () => {
  assert.equal(liftToAffinity(1, 0), 0.5)

  // A lift of L and a lift of 1/L must land equidistant from neutral, or
  // "twice as often" and "half as often" would be different sizes of effect.
  for (const lift of [1.5, 2, 3, 4]) {
    const above = liftToAffinity(lift, 0) - 0.5
    const below = 0.5 - liftToAffinity(1 / lift, 0)
    assert.ok(Math.abs(above - below) < 1e-12, `asymmetric at ${lift}`)
  }
})

test('affinity is bounded without clamping, and floored', () => {
  for (const lift of [0, 0.01, 1, 10, 1000]) {
    const affinity = liftToAffinity(lift)
    assert.ok(affinity >= ERA_AFFINITY_FLOOR && affinity <= 1, `${lift} -> ${affinity}`)
  }
  assert.equal(liftToAffinity(0), ERA_AFFINITY_FLOOR, 'the floor binds at total avoidance')
  assert.ok(liftToAffinity(1000) < 1, 'and nothing ever reaches a certain 1')
})

test('a nonsense lift reads as neutral rather than as avoidance', () => {
  assert.equal(liftToAffinity(NaN), 0.5)
  assert.equal(liftToAffinity(-1), 0.5)
  assert.equal(liftToAffinity(Infinity), 0.5)
})

test('no history and no library both produce a neutral index', () => {
  assert.equal(buildEraAffinities(new Map(), LIBRARY).size, 0)
  assert.equal(buildEraAffinities(RECENCY_VIEWER, new Map()).size, 0)

  const empty = buildEraAffinities(new Map(), new Map())
  assert.equal(eraAffinityFor(empty, 1999), 0.5, 'an empty index is neutral everywhere')
})

test('an unknown or implausible year is neutral, not penalised', () => {
  const index = buildEraAffinities(RECENCY_VIEWER, LIBRARY)

  assert.equal(eraAffinityFor(index, null), 0.5)
  assert.equal(eraAffinityFor(index, undefined), 0.5)
  assert.equal(eraAffinityFor(index, 1700), 0.5, 'before cinema')
  assert.equal(eraAffinityFor(index, 3000), 0.5, 'implausibly far ahead')
  assert.equal(eraAffinityFor(index, NaN), 0.5)

  // A decade the library does not stock at all is also neutral.
  assert.equal(eraAffinityFor(index, 1890), 0.5)
  assert.equal(eraAffinityEntry(index, 1890), null)
})

test('a real year resolves to its decade', () => {
  const index = buildEraAffinities(RECENCY_VIEWER, LIBRARY)

  assert.equal(eraAffinityFor(index, 2021), index.get(2020)!.affinity)
  assert.equal(eraAffinityFor(index, 2029), index.get(2020)!.affinity)
  assert.equal(eraAffinityFor(index, 1978), index.get(1970)!.affinity)
  assert.ok(eraAffinityFor(index, 2021) > eraAffinityFor(index, 1955))
})

test('year folding tolerates what the database actually returns', () => {
  const counts = foldYearsToDecades([
    { year: 1994, n: 3 },
    { year: 1999, n: 2 },
    { year: null, n: 40 },
    { year: 1500, n: 7 },
    { year: 2001, n: 0 },
  ])

  assert.equal(counts.get(1990), 5, 'same decade accumulates')
  assert.equal(counts.has(1500), false, 'implausible years are dropped, not bucketed')
  assert.equal(counts.has(2000), false, 'a zero count adds no decade')
  assert.equal(counts.size, 1, 'a null year contributes nothing at all')
})

test('the summary names the extremes', () => {
  const summary = summarizeEraAffinities(buildEraAffinities(RECENCY_VIEWER, LIBRARY))

  assert.equal(summary.decades, 13)
  assert.equal(summary.sought?.decade, 2020)
  assert.equal(summary.sought?.lift, 2.37)
  assert.equal(summary.avoided?.decade, 1960)
})

test('the summary of an empty index reports nothing rather than a default', () => {
  const summary = summarizeEraAffinities(new Map())
  assert.equal(summary.decades, 0)
  assert.equal(summary.sought, null)
  assert.equal(summary.avoided, null)
})

test('the pseudo-count is in units of titles', () => {
  // Worth pinning because it is the one constant an operator might reasonably
  // want to reason about: a decade nobody has watched sits at
  // a / (expected + a), so it approaches neutral exactly when the library holds
  // too few titles for `expected` to reach a.
  const library: DecadeCounts = new Map([[1970, 100]])
  const index = buildEraAffinities(new Map([[1970, 0]]), library, { floor: 0 })

  // expected == watchedTotal * 1, but watchedTotal is 0 here, so nothing is
  // built at all -- the guard above fires first.
  assert.equal(index.size, 0)

  const withHistory = buildEraAffinities(
    new Map([[1980, 20]]),
    new Map([
      [1970, 100],
      [1980, 100],
    ]),
    { floor: 0 }
  )
  // 20 watched, half the library is 1970s -> expected 10, watched 0.
  assert.equal(round2(withHistory.get(1970)!.lift), round2(ERA_PSEUDO_COUNT / (10 + ERA_PSEUDO_COUNT)))
})
