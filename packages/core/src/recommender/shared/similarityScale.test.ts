import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSimilarityScale,
  normalizeSimilarity,
  calculateBaseScore,
  summarizeScoreComponents,
} from './scoring.js'

/**
 * A candidate pool shaped like the live instance's: ~16k items whose cosine
 * similarity to the taste vector sits in a narrow cone. The measured p10-p90
 * spread there was 0.041, which is what this reproduces.
 */
function conePool(count = 16000, mean = 0.62, stdDev = 0.016): number[] {
  const values: number[] = []
  for (let i = 0; i < count; i++) {
    // Box-Muller from a deterministic sequence: no RNG, so the test cannot flake.
    const u1 = (i + 0.5) / count
    const u2 = ((i * 7919) % count) / count
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    values.push(mean + stdDev * z)
  }
  return values
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.round(fraction * (sorted.length - 1))]
}

// ============================================================================
// 1. The bug this exists to fix
// ============================================================================

test('a cone-compressed pool gets a spread comparable to the other score terms', () => {
  const raw = conePool()
  const scale = buildSimilarityScale(raw)
  const normalized = raw.map((s) => normalizeSimilarity(s, scale))

  const rawSpread = percentile(raw, 0.9) - percentile(raw, 0.1)
  const normalizedSpread = percentile(normalized, 0.9) - percentile(normalized, 0.1)

  // What the score used to consume: essentially nothing.
  assert.ok(rawSpread < 0.06, `raw p10-p90 should be tiny, got ${rawSpread}`)

  // What it consumes now, against rating's measured ~0.46 and novelty's ~0.26.
  assert.ok(
    normalizedSpread > 0.4,
    `normalized p10-p90 should be comparable to the other terms, got ${normalizedSpread}`
  )
})

test('the configured weight finally buys the influence it claims', () => {
  // The live instance's weights, and its measured per-term distributions.
  const config = { similarityWeight: 0.72, noveltyWeight: 0.01, ratingWeight: 0.25 }
  const raw = conePool()
  const scale = buildSimilarityScale(raw)

  const candidates = raw.map((similarity, i) => {
    const normalizedSimilarity = normalizeSimilarity(similarity, scale)
    // Ratings spread across the tiers the way a real library does.
    const ratingScore = 0.2 + 0.7 * (((i * 7919) % 1000) / 1000)
    const novelty = 0.57 + 0.26 * (((i * 104729) % 1000) / 1000)
    return {
      similarity,
      normalizedSimilarity,
      novelty,
      ratingScore,
      finalScore: calculateBaseScore(normalizedSimilarity, novelty, ratingScore, config),
    }
  })

  const report = summarizeScoreComponents(candidates, config)

  // The regression: rating out-influenced similarity roughly 3:1 despite
  // carrying a third of the weight.
  assert.ok(
    report.influence.similarity > report.influence.rating,
    `similarity (${report.influence.similarity}) must out-influence rating (${report.influence.rating})`
  )

  // And roughly in proportion to the weights, rather than merely ahead. The
  // terms have different natural spreads, so this is an order-of-magnitude
  // check, not an equality.
  const influenceRatio = report.influence.similarity / report.influence.rating
  const weightRatio = config.similarityWeight / config.ratingWeight
  assert.ok(
    influenceRatio > weightRatio * 0.75 && influenceRatio < weightRatio * 2,
    `influence ratio ${influenceRatio} should track weight ratio ${weightRatio}`
  )
})

test('the raw cosine is still reported, so the compression stays visible', () => {
  const raw = conePool(1000)
  const scale = buildSimilarityScale(raw)
  const candidates = raw.map((similarity) => ({
    similarity,
    normalizedSimilarity: normalizeSimilarity(similarity, scale),
    novelty: 0.5,
    ratingScore: 0.5,
    finalScore: 0.5,
  }))

  const report = summarizeScoreComponents(candidates, {
    similarityWeight: 0.72,
    noveltyWeight: 0.01,
    ratingWeight: 0.25,
  })

  const rawSpread = report.rawSimilarity.p90 - report.rawSimilarity.p10
  const usedSpread = report.similarity.p90 - report.similarity.p10
  assert.ok(rawSpread < 0.06)
  assert.ok(usedSpread > 0.4)
  assert.ok(report.rawSimilarity.max <= 1)
})

// ============================================================================
// 2. Properties the transform must hold
// ============================================================================

test('normalizing preserves the similarity ordering exactly', () => {
  const raw = conePool(500)
  const scale = buildSimilarityScale(raw)

  const byRaw = [...raw].sort((a, b) => b - a)
  const byNormalized = [...raw].sort(
    (a, b) => normalizeSimilarity(b, scale) - normalizeSimilarity(a, scale)
  )

  assert.deepEqual(byNormalized, byRaw, 'the transform must be strictly monotone')
})

test('nothing is clipped, so the top of the pool keeps its resolution', () => {
  const raw = conePool(2000)
  const scale = buildSimilarityScale(raw)
  const normalized = raw.map((s) => normalizeSimilarity(s, scale))

  for (const value of normalized) {
    assert.ok(value > 0 && value < 1, `expected an open interval, got ${value}`)
  }

  // The point of not clipping: the best hundred candidates -- the ones
  // selection actually chooses between -- must not collapse into a tie the way
  // a percentile clamp at p95 would have made them.
  const top = [...normalized].sort((a, b) => b - a).slice(0, 100)
  assert.ok(new Set(top).size === top.length, 'the top of the pool must stay separable')
})

test('an outlier squashes instead of compressing everyone else', () => {
  // min-max rescaling would map the bulk of this pool into a sliver; the point
  // of standardizing then squashing is that one weird candidate cannot do that.
  const raw = [...conePool(1000), 0.02]
  const scale = buildSimilarityScale(raw)
  const bulk = raw.slice(0, 1000).map((s) => normalizeSimilarity(s, scale))

  const spread = percentile(bulk, 0.9) - percentile(bulk, 0.1)
  assert.ok(spread > 0.35, `an outlier should not flatten the bulk, got ${spread}`)
  assert.ok(normalizeSimilarity(0.02, scale) < 0.01, 'the outlier still ranks last')
})

test('a candidate at the pool mean scores a neutral 0.5', () => {
  const scale = buildSimilarityScale(conePool(1000, 0.62, 0.016))
  assert.ok(Math.abs(normalizeSimilarity(scale.mean, scale) - 0.5) < 1e-12)
})

test('one standard deviation lands where the doc comment says it does', () => {
  const scale = { mean: 0.6, stdDev: 0.02 }
  assert.ok(Math.abs(normalizeSimilarity(0.62, scale) - 0.7311) < 1e-3)
  assert.ok(Math.abs(normalizeSimilarity(0.64, scale) - 0.8808) < 1e-3)
  assert.ok(Math.abs(normalizeSimilarity(0.58, scale) - 0.2689) < 1e-3)
})

// ============================================================================
// 3. Degenerate pools
// ============================================================================

test('a pool with no spread scores neutral rather than inventing separation', () => {
  const scale = buildSimilarityScale([0.6, 0.6, 0.6, 0.6])
  assert.equal(scale.stdDev, 0)
  assert.equal(normalizeSimilarity(0.6, scale), 0.5)
  assert.equal(normalizeSimilarity(0.9, scale), 0.5)
})

test('empty and single-candidate pools are handled', () => {
  assert.deepEqual(buildSimilarityScale([]), { mean: 0, stdDev: 0 })
  assert.equal(normalizeSimilarity(0.6, buildSimilarityScale([])), 0.5)

  const single = buildSimilarityScale([0.7])
  assert.equal(single.mean, 0.7)
  assert.equal(single.stdDev, 0)
  assert.equal(normalizeSimilarity(0.7, single), 0.5)
})

test('non-finite values are skipped rather than poisoning the scale', () => {
  const scale = buildSimilarityScale([0.5, Number.NaN, 0.7, Number.POSITIVE_INFINITY])
  assert.ok(Number.isFinite(scale.mean))
  assert.ok(Number.isFinite(scale.stdDev))
  assert.equal(scale.mean, 0.6)
  assert.equal(normalizeSimilarity(Number.NaN, scale), 0.5)
})

test('negative cosine still normalizes, and calculateBaseScore still floors', () => {
  const scale = buildSimilarityScale([-0.4, -0.2, 0.1, 0.3])
  const normalized = normalizeSimilarity(-0.4, scale)

  assert.ok(normalized > 0 && normalized < 0.5, 'taste-opposite content ranks low, not negative')

  const score = calculateBaseScore(normalized, 0.5, 0.5, {
    similarityWeight: 1,
    noveltyWeight: 0,
    ratingWeight: 0,
  })
  assert.ok(score >= 0 && score <= 1)
})
