import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGenreFamiliarity,
  calculateGenreNoveltyScore,
  summarizeScoreComponents,
  NOVELTY_SWEET_SPOT,
  NOVELTY_PEAK,
  NOVELTY_FAMILIAR_FLOOR,
  NOVELTY_ALIEN_FLOOR,
  blendWeightShares,
  calculateBaseScore,
  effectiveBlendWeights,
  noveltyGain,
  spreadOf,
  TARGET_COMPONENT_SPREAD,
} from './scoring.js'

/**
 * Verbatim copy of the branch structure that lived in calculateNoveltyScore
 * before this change, reduced to the three values its branches could produce
 * at a given `avgNovelty`. Its continuous term was pinned near 0.85 in
 * practice (dividing a genre's count by TOTAL genre occurrences gives ~1/20
 * for every genre once a library has ~20 of them), so 0.85 is the
 * representative input.
 */
function legacyBranchValues(avgNovelty: number) {
  return {
    sweetSpot: 0.5 + avgNovelty * 0.4,
    allFamiliar: 0.4 + avgNovelty * 0.2,
    tooNovel: 0.3 + avgNovelty * 0.2,
  }
}

/** A familiarity map whose single genre sits at exactly `value`. */
const atFamiliarity = (value: number) => new Map([['g', value]])
const scoreAtFamiliarity = (value: number) =>
  calculateGenreNoveltyScore(['g'], atFamiliarity(value))

// ============================================================================
// 1. Range: the full [0,1], with the old curve's proportions intact
// ============================================================================

test('the band spans the whole range a weighted average assumes', () => {
  // The blend is a weighted AVERAGE of three 0-1 terms, and influence is
  // weight share x realized spread. A term confined to 0.37 of the range hands
  // back most of its configured weight before any data is involved -- measured
  // live, a novelty weight of 8.1% delivered 2.1-4.5% of the movement.
  assert.equal(NOVELTY_ALIEN_FLOOR, 0)
  assert.equal(NOVELTY_PEAK, 1)
})

test('widening rescaled the curve without reshaping it', () => {
  // The whole point of a pure stretch: where the familiar floor sits BETWEEN
  // the other two must not move, or this stops being a scale change and starts
  // being a redesign of what novelty rewards.
  const legacy = legacyBranchValues(0.85)
  const legacyPosition =
    (legacy.allFamiliar - legacy.tooNovel) / (legacy.sweetSpot - legacy.tooNovel)
  const position =
    (NOVELTY_FAMILIAR_FLOOR - NOVELTY_ALIEN_FLOOR) / (NOVELTY_PEAK - NOVELTY_ALIEN_FLOOR)

  assert.ok(
    Math.abs(position - legacyPosition) < 0.005,
    `familiar floor moved: ${position} vs ${legacyPosition}`
  )
})

test('no input escapes the band', () => {
  for (let f = 0; f <= 1.0001; f += 0.001) {
    const score = scoreAtFamiliarity(Math.min(1, f))
    assert.ok(
      score >= NOVELTY_ALIEN_FLOOR - 1e-12 && score <= NOVELTY_PEAK + 1e-12,
      `familiarity ${f} produced ${score}, outside [${NOVELTY_ALIEN_FLOOR}, ${NOVELTY_PEAK}]`
    )
  }
})

// ============================================================================
// 2. Shape: peaked, continuous, monotone on each side
// ============================================================================

test('the response peaks at the sweet spot and floors at both extremes', () => {
  // familiarity 0 => novelty 1 (all alien); familiarity 1 => novelty 0 (all staples)
  assert.ok(Math.abs(scoreAtFamiliarity(1) - NOVELTY_FAMILIAR_FLOOR) < 1e-12)
  assert.ok(Math.abs(scoreAtFamiliarity(0) - NOVELTY_ALIEN_FLOOR) < 1e-12)
  assert.ok(Math.abs(scoreAtFamiliarity(1 - NOVELTY_SWEET_SPOT) - NOVELTY_PEAK) < 1e-12)
})

test('the curve is continuous -- no jump anywhere near the old 0.27 branch step', () => {
  const oldBranchStep = Math.abs(0.5 + 0.85 * 0.4 - (0.4 + 0.85 * 0.2)) // 0.27
  let maxStep = 0
  let previous = scoreAtFamiliarity(0)

  for (let f = 0.001; f <= 1.0001; f += 0.001) {
    const current = scoreAtFamiliarity(Math.min(1, f))
    maxStep = Math.max(maxStep, Math.abs(current - previous))
    previous = current
  }

  assert.ok(maxStep < 0.01, `largest step was ${maxStep}`)
  assert.ok(maxStep < oldBranchStep / 10, `still stepping like the old branches (${maxStep})`)
})

test('novelty rises toward the sweet spot and falls past it', () => {
  const peakFamiliarity = 1 - NOVELTY_SWEET_SPOT

  // Familiarity falling from 1 toward the peak => novelty rising => score rising
  let previous = scoreAtFamiliarity(1)
  for (let f = 1 - 0.01; f >= peakFamiliarity; f -= 0.01) {
    const current = scoreAtFamiliarity(f)
    assert.ok(current >= previous - 1e-12, `not monotone rising at familiarity ${f}`)
    previous = current
  }

  // Past the peak, more novelty must cost
  previous = scoreAtFamiliarity(peakFamiliarity)
  for (let f = peakFamiliarity - 0.01; f >= 0; f -= 0.01) {
    const current = scoreAtFamiliarity(f)
    assert.ok(current <= previous + 1e-12, `not monotone falling at familiarity ${f}`)
    previous = current
  }
})

test('the alien end falls further from the peak than the familiar end', () => {
  // Both ends are penalised, the alien one harder -- true of the legacy
  // branches (tooNovel sat a flat 0.1 below allFamiliar at every input) and
  // preserved by the stretch. A comment in scoring.ts used to claim the
  // reverse; the code never did it.
  const alienDrop = NOVELTY_PEAK - NOVELTY_ALIEN_FLOOR
  const familiarDrop = NOVELTY_PEAK - NOVELTY_FAMILIAR_FLOOR
  assert.ok(alienDrop > familiarDrop, 'alien end should fall further from the peak')
})

// ============================================================================
// 3. Familiarity indexing
// ============================================================================

test('familiarity is normalised by the user own peak genre', () => {
  const familiarity = buildGenreFamiliarity(
    new Map([
      ['Drama', 400],
      ['Action', 300],
      ['Western', 5],
    ])
  )

  assert.equal(familiarity.get('drama'), 1)
  assert.equal(familiarity.get('action'), 0.75)
  assert.equal(familiarity.get('western'), 5 / 400)
  assert.equal(familiarity.get('documentary'), undefined)
})

test('familiarity does not depend on how many genres items carry', () => {
  // The flaw in dividing by total occurrences: doubling every count (as tagging
  // items with more genres would) changed every value. Max-normalising cannot.
  const single = buildGenreFamiliarity(new Map([['A', 10], ['B', 5]]))
  const doubled = buildGenreFamiliarity(new Map([['A', 20], ['B', 10]]))

  assert.equal(single.get('a'), doubled.get('a'))
  assert.equal(single.get('b'), doubled.get('b'))
})

test('familiarity keys are lowercased and matching is case-insensitive', () => {
  const familiarity = buildGenreFamiliarity(new Map([['Science Fiction', 10]]))
  assert.equal(familiarity.get('science fiction'), 1)
  assert.equal(calculateGenreNoveltyScore(['SCIENCE FICTION'], familiarity), NOVELTY_FAMILIAR_FLOOR)
})

test('degenerate inputs stay neutral rather than inventing a score', () => {
  const familiarity = buildGenreFamiliarity(new Map([['Drama', 10]]))

  assert.equal(calculateGenreNoveltyScore([], familiarity), 0.5, 'item with no genres')
  assert.equal(calculateGenreNoveltyScore(['Drama'], new Map()), 0.5, 'user with no history')
  assert.equal(buildGenreFamiliarity(new Map()).size, 0)
  assert.equal(buildGenreFamiliarity(new Map([['A', 0], ['B', -3]])).size, 0)
  assert.equal(buildGenreFamiliarity(new Map([['A', NaN]])).size, 0)
})

// ============================================================================
// 4. The actual bug: the score has to spread across a real candidate set
// ============================================================================

test('novelty spreads meaningfully across a realistic candidate set', () => {
  const familiarity = buildGenreFamiliarity(
    new Map([
      ['Drama', 400],
      ['Action', 300],
      ['Thriller', 200],
      ['Comedy', 100],
      ['Science Fiction', 60],
      ['Horror', 30],
      ['Western', 5],
    ])
  )

  const candidates = [
    ['Drama'],
    ['Drama', 'Action'],
    ['Action', 'Thriller'],
    ['Thriller', 'Comedy'],
    ['Comedy', 'Science Fiction'],
    ['Horror', 'Western'],
    ['Documentary', 'Music'],
    ['Drama', 'Western'],
  ]

  const scores = candidates.map((genres) => calculateGenreNoveltyScore(genres, familiarity))
  const spread = Math.max(...scores) - Math.min(...scores)

  // The old implementation's continuous term managed ~0.08 across any real
  // distribution; everything else came from a discrete branch. If this
  // regresses toward that, the pinning is back.
  assert.ok(spread > 0.2, `novelty only spread ${spread.toFixed(4)} across the set`)

  // And the values must be genuinely distinct, not clustered on a few points.
  const distinct = new Set(scores.map((s) => s.toFixed(4)))
  assert.ok(distinct.size >= 6, `only ${distinct.size} distinct values across 8 candidates`)
})

// ============================================================================
// 5. Ordering: the intent of the curve, stated as a ranking
// ============================================================================

test('a familiar anchor plus something new beats both extremes', () => {
  const familiarity = buildGenreFamiliarity(
    new Map([
      ['Drama', 400],
      ['Action', 300],
      ['Western', 5],
    ])
  )

  const anchorPlusNew = calculateGenreNoveltyScore(['Drama', 'Documentary'], familiarity)
  const allStaples = calculateGenreNoveltyScore(['Drama', 'Action'], familiarity)
  const allAlien = calculateGenreNoveltyScore(['Documentary', 'Music'], familiarity)

  assert.ok(anchorPlusNew > allStaples, 'partial novelty should beat pure familiarity')
  assert.ok(anchorPlusNew > allAlien, 'partial novelty should beat pure novelty')
  assert.ok(allStaples > allAlien, 'staples should still beat wholly unfamiliar territory')
})

// ============================================================================
// 6. Component influence reporting
// ============================================================================

/**
 * The score blend reads normalizedSimilarity, so these fixtures set it to the
 * same value as the raw cosine -- the percentile/influence assertions below are
 * about the summary maths, not about the rescaling.
 */
function scored(similarity: number, novelty: number, ratingScore: number, finalScore: number) {
  return { similarity, normalizedSimilarity: similarity, novelty, ratingScore, finalScore }
}

test('summarizeScoreComponents reports nearest-rank percentiles', () => {
  const candidates = Array.from({ length: 11 }, (_, i) => scored(i / 10, 0.5, 0.5, 0.5))
  const report = summarizeScoreComponents(candidates, {
    similarityWeight: 1,
    noveltyWeight: 0,
    ratingWeight: 0,
  })

  assert.equal(report.count, 11)
  assert.equal(report.similarity.min, 0)
  assert.equal(report.similarity.max, 1)
  assert.ok(Math.abs(report.similarity.p50 - 0.5) < 1e-12)
  assert.ok(Math.abs(report.similarity.p10 - 0.1) < 1e-12)
  assert.ok(Math.abs(report.similarity.p90 - 0.9) < 1e-12)
})

test('influence is the weight share times the realised spread', () => {
  // novelty pinned to a single value must report zero influence no matter how
  // large its configured weight -- that is the whole point of the metric.
  const candidates = Array.from({ length: 21 }, (_, i) => scored(i / 20, 0.7, i / 20, 0.5))
  const report = summarizeScoreComponents(candidates, {
    similarityWeight: 0.4,
    noveltyWeight: 0.2,
    ratingWeight: 0.2,
  })

  assert.equal(report.novelty.p90 - report.novelty.p10, 0)
  assert.equal(report.influence.novelty, 0)

  const expected = (0.4 / 0.8) * (report.similarity.p90 - report.similarity.p10)
  assert.ok(Math.abs(report.influence.similarity - expected) < 1e-12)

  // Equal spread, half the weight -> half the influence.
  assert.ok(Math.abs(report.influence.similarity - 2 * report.influence.rating) < 1e-12)
})

test('similarity influence uses the floored value the score actually consumes', () => {
  // calculateBaseScore floors negative cosine at 0, so a pool full of negative
  // similarities has no spread as far as the score is concerned.
  const candidates = [scored(-0.5, 0.5, 0.5, 0.5), scored(-0.1, 0.5, 0.5, 0.5)]
  const report = summarizeScoreComponents(candidates, {
    similarityWeight: 1,
    noveltyWeight: 0,
    ratingWeight: 0,
  })

  assert.equal(report.similarity.min, 0)
  assert.equal(report.similarity.max, 0)
  assert.equal(report.influence.similarity, 0)

  // The raw cosine is reported as measured, not floored -- it exists to show
  // how compressed the retrieved pool was, not to feed the score.
  assert.equal(report.rawSimilarity.min, -0.5)
  assert.equal(report.rawSimilarity.max, -0.1)
})

test('summarizeScoreComponents survives an empty pool and zeroed weights', () => {
  const empty = summarizeScoreComponents([], {
    similarityWeight: 0.4,
    noveltyWeight: 0.2,
    ratingWeight: 0.2,
  })
  assert.equal(empty.count, 0)
  assert.equal(empty.similarity.p50, 0)
  assert.equal(empty.influence.novelty, 0)

  // Zero total weight mirrors calculateBaseScore's equal-thirds fallback.
  const zeroed = summarizeScoreComponents(
    [scored(0, 0, 0, 0), scored(1, 1, 1, 1)],
    { similarityWeight: 0, noveltyWeight: 0, ratingWeight: 0 }
  )
  for (const value of Object.values(zeroed.influence)) {
    assert.ok(Number.isFinite(value), 'influence must stay finite when every slider is zero')
  }
})


/**
 * The shares the insights panel prints under each bar. The property that
 * matters is not the arithmetic — it is that the printed multipliers, applied
 * to the printed components, reproduce the printed match. A panel that shows
 * three numbers and a total the reader cannot derive is what this exists to
 * stop.
 */
test('blendWeightShares reproduces calculateBaseScore', () => {
  const weights = { similarityWeight: 0.4, noveltyWeight: 0.2, ratingWeight: 0.2 }
  const shares = blendWeightShares(weights)
  assert.ok(shares)

  // The configured sliders are 0.4/0.2/0.2 but the blend divides by their sum,
  // so what the reader must multiply by is 0.5/0.25/0.25.
  assert.equal(shares.similarity, 0.5)
  assert.equal(shares.novelty, 0.25)
  assert.equal(shares.rating, 0.25)

  // The live card that prompted this: 75 / 76 / 28 under a headline of 63.
  const [s, n, r] = [0.7531, 0.7629, 0.28]
  const byShares = shares.similarity * s + shares.novelty * n + shares.rating * r
  assert.ok(
    Math.abs(byShares - calculateBaseScore(s, n, r, weights)) < 1e-12,
    'shares must reproduce the blend exactly, or the panel shows an arithmetic that does not close'
  )
  assert.equal(Math.round(byShares * 100), 64)
})

test('blendWeightShares sums to 1 for any slider combination', () => {
  for (const similarityWeight of [0, 0.15, 0.4, 1]) {
    for (const noveltyWeight of [0, 0.2, 0.75]) {
      for (const ratingWeight of [0, 0.2, 0.9]) {
        const shares = blendWeightShares({ similarityWeight, noveltyWeight, ratingWeight })
        assert.ok(shares)
        const total = shares.similarity + shares.novelty + shares.rating
        assert.ok(
          Math.abs(total - 1) < 1e-12,
          `shares must total 1, got ${total} for ${similarityWeight}/${noveltyWeight}/${ratingWeight}`
        )
      }
    }
  }
})

test('blendWeightShares mirrors the zero-total fallback rather than dividing by zero', () => {
  const shares = blendWeightShares({ similarityWeight: 0, noveltyWeight: 0, ratingWeight: 0 })
  assert.ok(shares)
  // calculateBaseScore averages the three when no slider carries weight.
  assert.ok(Math.abs(shares.similarity - 1 / 3) < 1e-12)
  const blended = shares.similarity * 0.6 + shares.novelty * 0.3 + shares.rating * 0.9
  assert.ok(
    Math.abs(
      blended - calculateBaseScore(0.6, 0.3, 0.9, { similarityWeight: 0, noveltyWeight: 0, ratingWeight: 0 })
    ) < 1e-12
  )
})

/**
 * A run predating migration 0147 recorded no weights, and there is no safe
 * number to assume: they are resolved per user and an admin can move them. The
 * panel must be told "cannot be stated", never handed a plausible default.
 */
test('blendWeightShares returns null for missing weights, never a default', () => {
  assert.equal(blendWeightShares(null), null)
  assert.equal(blendWeightShares(undefined), null)
  assert.equal(blendWeightShares({}), null)
  assert.equal(
    blendWeightShares({ similarityWeight: 0.4, noveltyWeight: 0.2 }),
    null,
    'a partially recorded run is not a recorded run'
  )
  assert.equal(
    blendWeightShares({ similarityWeight: Number.NaN, noveltyWeight: 0.2, ratingWeight: 0.2 }),
    null
  )
})

// ============================================================================
// 6. Weight correction -- does the slider buy the influence it claims?
// ============================================================================

/**
 * An evenly spaced series whose p90 - p10 is exactly `spread`. Nearest-rank
 * percentiles over 101 evenly spaced points sit at indices 10 and 90, so the
 * gap covers 80% of the range.
 */
function poolWithSpread(spread: number, n = 101): number[] {
  const range = spread / 0.8
  return Array.from({ length: n }, (_, i) => 0.5 - range / 2 + (range * i) / (n - 1))
}

/** Influence normalised to shares, i.e. what fraction of the movement each term drives. */
function influenceShares(inf: { similarity: number; novelty: number; rating: number }) {
  const total = inf.similarity + inf.novelty + inf.rating
  return {
    similarity: inf.similarity / total,
    novelty: inf.novelty / total,
    rating: inf.rating / total,
  }
}

function maxDeviation(
  a: { similarity: number; novelty: number; rating: number },
  b: { similarity: number; novelty: number; rating: number }
) {
  return Math.max(
    Math.abs(a.similarity - b.similarity),
    Math.abs(a.novelty - b.novelty),
    Math.abs(a.rating - b.rating)
  )
}

test('spreadOf is the same p90 - p10 the influence report uses', () => {
  const values = poolWithSpread(0.4)
  assert.ok(Math.abs(spreadOf(values) - 0.4) < 1e-9, `got ${spreadOf(values)}`)
})

test('spreadOf ignores non-finite values rather than propagating NaN', () => {
  const values = [...poolWithSpread(0.4), NaN, Infinity]
  assert.ok(Number.isFinite(spreadOf(values)))
})

test('a term already on scale gets no gain', () => {
  assert.equal(noveltyGain(TARGET_COMPONENT_SPREAD), 1)
})

test('the novelty gain is clamped at both ends', () => {
  // A pool with almost no novelty signal must not have the ranking handed to
  // it. This is the guard against amplifying noise.
  assert.equal(noveltyGain(0.001), 1.5)
  assert.equal(noveltyGain(10), 0.7)
})

test('an unmeasurable spread means no gain, never an infinite one', () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.equal(noveltyGain(bad), 1, `spread ${bad}`)
  }
})

test('similarity is the reference and is never re-gained', () => {
  // normalizeSimilarity is already the correction for that term; applying a
  // second one would double-count it.
  const config = { similarityWeight: 0.7, noveltyWeight: 0.08, ratingWeight: 0.21 }
  for (const spread of [0.1, 0.5, 0.9]) {
    assert.equal(effectiveBlendWeights(config, spread).similarityWeight, 0.7)
  }
})

test('the rating gain is fixed, because its shortfall is', () => {
  // Measured 0.46 for eight of nine live users and 0.44 for the ninth, so
  // there is nothing per-run to adapt to.
  const config = { similarityWeight: 0.7, noveltyWeight: 0.08, ratingWeight: 0.21 }
  const a = effectiveBlendWeights(config, 0.2).ratingWeight
  const b = effectiveBlendWeights(config, 0.8).ratingWeight
  assert.equal(a, b)
  assert.ok(a > config.ratingWeight, 'rating is under-spread, so its weight must rise')
})

test('a zero weight stays zero whatever the gain', () => {
  const off = { similarityWeight: 0.7, noveltyWeight: 0, ratingWeight: 0 }
  const corrected = effectiveBlendWeights(off, 0.2)
  assert.equal(corrected.noveltyWeight, 0)
  assert.equal(corrected.ratingWeight, 0)
})

test('correcting the weights makes realised influence track the configured shares', () => {
  // The live configuration on the instance this was measured from.
  const config = { similarityWeight: 0.7, noveltyWeight: 0.08, ratingWeight: 0.21 }

  // Measured spreads, with novelty at its post-widening value.
  const sim = poolWithSpread(0.577)
  const nov = poolWithSpread(0.65)
  const rat = poolWithSpread(0.46)
  const candidates = sim.map((s, i) => ({
    similarity: s,
    normalizedSimilarity: s,
    novelty: nov[i],
    ratingScore: rat[i],
    finalScore: 0,
  }))

  const configured = blendWeightShares(config)
  assert.ok(configured)

  const before = influenceShares(summarizeScoreComponents(candidates, config).influence)
  const corrected = effectiveBlendWeights(config, spreadOf(nov))
  const after = influenceShares(summarizeScoreComponents(candidates, corrected).influence)

  const errBefore = maxDeviation(before, configured)
  const errAfter = maxDeviation(after, configured)

  assert.ok(errAfter < errBefore, `correction made it worse: ${errAfter} vs ${errBefore}`)
  // Within a percentage point of what the admin actually set.
  assert.ok(errAfter < 0.01, `still off by ${errAfter}`)
})

test('the correction still helps when the clamp binds', () => {
  // A viewer with concentrated genre taste: novelty barely varies, so the gain
  // wants 2.4x and is held at 1.5. Partial correction, but correction.
  const config = { similarityWeight: 0.7, noveltyWeight: 0.08, ratingWeight: 0.21 }
  const sim = poolWithSpread(0.577)
  const nov = poolWithSpread(0.24)
  const rat = poolWithSpread(0.46)
  const candidates = sim.map((s, i) => ({
    similarity: s,
    normalizedSimilarity: s,
    novelty: nov[i],
    ratingScore: rat[i],
    finalScore: 0,
  }))

  const configured = blendWeightShares(config)
  assert.ok(configured)

  const before = influenceShares(summarizeScoreComponents(candidates, config).influence)
  const after = influenceShares(
    summarizeScoreComponents(candidates, effectiveBlendWeights(config, spreadOf(nov))).influence
  )

  assert.ok(maxDeviation(after, configured) < maxDeviation(before, configured))
})

test('correcting weights cannot push the blended score out of [0,1]', () => {
  // calculateBaseScore divides by the total weight, so gains change the shares
  // and never the bound -- but the gains are the first thing that can make a
  // weight exceed its slider's 0-1 range, so pin it.
  const config = { similarityWeight: 1, noveltyWeight: 1, ratingWeight: 1 }
  const corrected = effectiveBlendWeights(config, 0.05)
  for (const value of [0, 0.5, 1]) {
    const score = calculateBaseScore(value, value, value, corrected)
    assert.ok(score >= -1e-12 && score <= 1 + 1e-12, `${value} produced ${score}`)
  }
})
