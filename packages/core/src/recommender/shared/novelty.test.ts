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
// 1. Range preservation -- this must not become a re-weighting
// ============================================================================

test('the curve passes through the values the old branches produced', () => {
  const legacy = legacyBranchValues(0.85)

  assert.ok(Math.abs(NOVELTY_PEAK - legacy.sweetSpot) < 1e-12, `peak ${NOVELTY_PEAK}`)
  assert.ok(
    Math.abs(NOVELTY_FAMILIAR_FLOOR - legacy.allFamiliar) < 1e-12,
    `familiar floor ${NOVELTY_FAMILIAR_FLOOR}`
  )
  assert.ok(
    Math.abs(NOVELTY_ALIEN_FLOOR - legacy.tooNovel) < 1e-12,
    `alien floor ${NOVELTY_ALIEN_FLOOR}`
  )
})

test('no input escapes the band, and the band is no wider than the old one', () => {
  // Widest the old implementation could ever reach, across avgNovelty 0..1.
  const widest = legacyBranchValues(1)
  const narrowest = legacyBranchValues(0)
  const oldMax = Math.max(widest.sweetSpot, widest.allFamiliar, widest.tooNovel)
  const oldMin = Math.min(narrowest.sweetSpot, narrowest.allFamiliar, narrowest.tooNovel)

  for (let f = 0; f <= 1.0001; f += 0.001) {
    const score = scoreAtFamiliarity(Math.min(1, f))
    assert.ok(
      score >= NOVELTY_ALIEN_FLOOR - 1e-12 && score <= NOVELTY_PEAK + 1e-12,
      `familiarity ${f} produced ${score}, outside [${NOVELTY_ALIEN_FLOOR}, ${NOVELTY_PEAK}]`
    )
    assert.ok(score >= oldMin && score <= oldMax, `familiarity ${f} escaped the old range`)
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

test('the alien penalty is milder than the familiar one, on purpose', () => {
  // A genre-alien item is already punished by low similarity; penalising it
  // twice was never the design. An all-staples item is what similarity
  // over-rewards, so novelty is the counterweight there.
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
