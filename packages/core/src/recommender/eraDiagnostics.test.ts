import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decadeOf,
  buildDecadeDistribution,
  summarizeEraFit,
  UNFAMILIAR_DECADE_SHARE,
} from './eraDiagnostics.js'

/** `count` items spread across `years`, cycling. */
function repeat(years: number[], count: number): number[] {
  return Array.from({ length: count }, (_, i) => years[i % years.length])
}

// ============================================================================
// 1. Bucketing
// ============================================================================

test('years bucket into their decade', () => {
  assert.equal(decadeOf(1978), 1970)
  assert.equal(decadeOf(1970), 1970)
  assert.equal(decadeOf(1979), 1970)
  assert.equal(decadeOf(1980), 1980)
  assert.equal(decadeOf(2024), 2020)
})

test('missing and implausible years are excluded rather than bucketed', () => {
  assert.equal(decadeOf(null), null)
  assert.equal(decadeOf(undefined), null)
  assert.equal(decadeOf(Number.NaN), null)
  // Bad metadata: a year of 0 or 999999 should not create a phantom decade.
  assert.equal(decadeOf(0), null)
  assert.equal(decadeOf(999999), null)
})

test('items without a year drop out of the denominator entirely', () => {
  const dist = buildDecadeDistribution([2015, 2016, null, undefined, 2017])
  assert.equal(dist.counted, 3, 'only the three real years are counted')
  assert.equal(dist.shares['2010'], 1)
})

// ============================================================================
// 2. Distribution
// ============================================================================

test('shares are fractions of the counted items and sum to one', () => {
  const dist = buildDecadeDistribution([...repeat([2015], 6), ...repeat([1985], 2), 1975, 1976])
  assert.equal(dist.counted, 10)
  assert.equal(dist.shares['2010'], 0.6)
  assert.equal(dist.shares['1980'], 0.2)
  assert.equal(dist.shares['1970'], 0.2)

  const total = Object.values(dist.shares).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(total - 1) < 1e-9)
})

test('the median year describes the middle of the history, not the mode', () => {
  assert.equal(buildDecadeDistribution([2010, 2012, 2020]).medianYear, 2012)
  // Even count averages the two middle values.
  assert.equal(buildDecadeDistribution([2010, 2012, 2014, 2020]).medianYear, 2013)
  assert.equal(buildDecadeDistribution([]).medianYear, null)
})

test('an empty population reports nothing rather than dividing by zero', () => {
  const dist = buildDecadeDistribution([null, undefined])
  assert.deepEqual(dist, { counted: 0, medianYear: null, shares: {} })
})

// ============================================================================
// 3. The comparison the diagnostic exists to make
// ============================================================================

const modernWatcher = repeat([2011, 2013, 2015, 2017, 2019], 200)

test('picks that match the user read as no drift and no unfamiliar share', () => {
  const report = summarizeEraFit(modernWatcher, modernWatcher, repeat([2012, 2016], 20))

  assert.equal(report.unfamiliarShare, 0)
  assert.ok(Math.abs(report.yearDrift ?? 99) <= 2)
})

test('picks skewing older than the user show up as negative drift', () => {
  const report = summarizeEraFit(modernWatcher, modernWatcher, repeat([1975, 1982], 20))

  assert.ok((report.yearDrift ?? 0) < -25, `expected a large negative drift, got ${report.yearDrift}`)
  assert.equal(report.unfamiliarShare, 1, 'every pick came from a decade they never watch')
})

test('the pool is the control: a low pick share against a high pool share means era is already handled', () => {
  // A library that is half pre-1990, a user who watches none of it, and picks
  // that came back modern anyway.
  const library = [...repeat([2012, 2015], 500), ...repeat([1975, 1985], 500)]
  const report = summarizeEraFit(modernWatcher, library, repeat([2013, 2016], 20))

  assert.ok(report.poolUnfamiliarShare > 0.4, 'the pool really was half unfamiliar')
  assert.equal(report.unfamiliarShare, 0, 'yet nothing unfamiliar was selected')

  // This gap is the finding: selection is filtering era without being told to.
  assert.ok(report.poolUnfamiliarShare - report.unfamiliarShare > 0.4)
})

test('picks matching the pool rather than the user means no era signal at all', () => {
  const library = [...repeat([2012, 2015], 500), ...repeat([1975, 1985], 500)]
  // Selection drawn evenly from the library, ignoring the user's era entirely.
  const report = summarizeEraFit(modernWatcher, library, repeat([2012, 1975], 20))

  assert.ok(
    Math.abs(report.poolUnfamiliarShare - report.unfamiliarShare) < 0.1,
    'picks track the pool, not the user -- nothing is enforcing era'
  )
})

test('a decade just under the threshold counts as unfamiliar, just over does not', () => {
  // 4% of history in the 1980s -- below the 5% threshold.
  const watched = [...repeat([2015], 96), ...repeat([1985], 4)]
  const below = summarizeEraFit(watched, [], repeat([1985], 10))
  assert.equal(below.unfamiliarShare, 1)

  // 6% -- above it.
  const watchedMore = [...repeat([2015], 94), ...repeat([1985], 6)]
  const above = summarizeEraFit(watchedMore, [], repeat([1985], 10))
  assert.equal(above.unfamiliarShare, 0)

  assert.equal(UNFAMILIAR_DECADE_SHARE, 0.05, 'the threshold the two cases straddle')
})

test('a user with no usable watch history reports zero rather than everything unfamiliar', () => {
  const report = summarizeEraFit([], repeat([1975], 50), repeat([1975], 10))

  assert.equal(report.watched.counted, 0)
  assert.equal(report.unfamiliarShare, 0, 'no history means no basis to call anything unfamiliar')
  assert.equal(report.poolUnfamiliarShare, 0)
  assert.equal(report.yearDrift, null)
  assert.equal(report.poolDrift, null)
})

test('poolDrift shows how far the library sits from the user, independently of the picks', () => {
  const oldLibrary = repeat([1975, 1980], 500)
  const report = summarizeEraFit(modernWatcher, oldLibrary, repeat([2015], 20))

  assert.ok((report.poolDrift ?? 0) < -30, 'the library itself is decades older than the user')
  assert.ok((report.yearDrift ?? -99) > -5, 'but the picks are not')
})
