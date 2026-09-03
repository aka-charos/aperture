import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeDiscoveryConfig, DISCOVERY_CONFIG_BOUNDS } from './config.js'
import { DEFAULT_DISCOVERY_CONFIG } from './types.js'

test('an empty blob returns the shipped defaults', () => {
  assert.deepEqual(sanitizeDiscoveryConfig({}), DEFAULT_DISCOVERY_CONFIG)
  assert.deepEqual(sanitizeDiscoveryConfig(null), DEFAULT_DISCOVERY_CONFIG)
})

test('a blob written before a field existed still returns a complete config', () => {
  // The stored value is JSON, so a config saved before maxPoolCandidates was
  // added has no such key. Merging over the defaults is what stops the pipeline
  // reading undefined for a bound it now depends on.
  const partial = { maxTotalCandidates: 500 }
  const config = sanitizeDiscoveryConfig(partial)
  assert.equal(config.maxTotalCandidates, 500)
  assert.equal(config.maxPoolCandidates, DEFAULT_DISCOVERY_CONFIG.maxPoolCandidates)
  assert.equal(config.poolMaxAgeDays, DEFAULT_DISCOVERY_CONFIG.poolMaxAgeDays)
})

test('values are clamped to their bounds rather than rejected', () => {
  const config = sanitizeDiscoveryConfig({
    maxCandidatesPerSource: 100000,
    poolMaxAgeDays: 0,
  })
  assert.equal(config.maxCandidatesPerSource, DISCOVERY_CONFIG_BOUNDS.maxCandidatesPerSource.max)
  assert.equal(config.poolMaxAgeDays, DISCOVERY_CONFIG_BOUNDS.poolMaxAgeDays.min)
})

test('an unusable number falls back to the default, not to zero', () => {
  // `Number(null)` is 0, not NaN, so a truthiness test here would silently turn
  // an absent knob into a hard zero -- which for maxTotalCandidates means
  // storing nothing at all.
  for (const bad of [undefined, null, NaN, Infinity, 'abc']) {
    const config = sanitizeDiscoveryConfig({ maxTotalCandidates: bad as never })
    assert.equal(
      config.maxTotalCandidates,
      DEFAULT_DISCOVERY_CONFIG.maxTotalCandidates,
      `${String(bad)} should fall back`
    )
  }
})

test('enriching more than is stored is corrected, not refused', () => {
  // Enrichment is a prefix of what gets stored, so the excess buys nothing but
  // TMDb requests. Lowering maxTotalCandidates must not fail a save because of
  // a field the admin did not touch.
  const config = sanitizeDiscoveryConfig({
    maxTotalCandidates: 60,
    maxEnrichedCandidates: 400,
  })
  assert.equal(config.maxEnrichedCandidates, 60)
})

test('all three weights at zero restore the defaults', () => {
  // Zero everywhere makes calculateBaseScore fall back to an unweighted mean,
  // which is a real behaviour but never a deliberate choice.
  const config = sanitizeDiscoveryConfig({
    similarityWeight: 0,
    popularityWeight: 0,
    recencyWeight: 0,
  })
  assert.equal(config.similarityWeight, DEFAULT_DISCOVERY_CONFIG.similarityWeight)
  assert.equal(config.popularityWeight, DEFAULT_DISCOVERY_CONFIG.popularityWeight)
  assert.equal(config.recencyWeight, DEFAULT_DISCOVERY_CONFIG.recencyWeight)
})

test('one weight at zero is respected', () => {
  // Turning a single term off is a legitimate choice and must survive.
  const config = sanitizeDiscoveryConfig({ recencyWeight: 0 })
  assert.equal(config.recencyWeight, 0)
  assert.equal(config.similarityWeight, DEFAULT_DISCOVERY_CONFIG.similarityWeight)
})

test('an off-list trakt period falls back rather than reaching the API', () => {
  assert.equal(
    sanitizeDiscoveryConfig({ traktPeriod: 'fortnightly' as never }).traktPeriod,
    DEFAULT_DISCOVERY_CONFIG.traktPeriod
  )
  assert.equal(sanitizeDiscoveryConfig({ traktPeriod: 'yearly' }).traktPeriod, 'yearly')
})

test('sanitising is idempotent', () => {
  // The value is sanitised on both read and write, so the second pass must not
  // move it again.
  const once = sanitizeDiscoveryConfig({ maxCandidatesPerSource: 999, minVoteAverage: 20 })
  assert.deepEqual(sanitizeDiscoveryConfig(once), once)
})
