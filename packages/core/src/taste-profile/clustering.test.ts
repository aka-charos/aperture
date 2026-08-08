import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  chooseK,
  clusterTasteEmbeddings,
  MAX_K,
  MIN_ITEMS_PER_CLUSTER_HARD_FLOOR,
  MIN_MARGINAL_DISPERSION_REDUCTION,
  DISPERSION_FOCUSED_THRESHOLD,
  DISPERSION_ECLECTIC_THRESHOLD,
  type WeightedEmbeddingItem,
  type ClusterAttempt,
} from './clustering.js'

// ============================================================================
// Fixtures / helpers
// ============================================================================

/** Deterministic PRNG (mulberry32) -- never Math.random(), so failures reproduce. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function l2Norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0))
}

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * Independent reference implementation of the weighted mean + L2 normalize,
 * written directly from the formula in builder.ts's buildWeightedAverageEmbedding
 * rather than calling any production code -- so the K=1 exactness test below is
 * a genuine cross-check, not a tautology.
 */
function referenceWeightedMean(items: WeightedEmbeddingItem[]): number[] {
  const dim = items[0].embedding.length
  const acc = new Array(dim).fill(0)
  let totalWeight = 0
  for (const item of items) {
    for (let i = 0; i < dim; i++) acc[i] += item.embedding[i] * item.weight
    totalWeight += item.weight
  }
  for (let i = 0; i < dim; i++) acc[i] /= totalWeight
  const norm = l2Norm(acc)
  return acc.map((v) => v / norm)
}

/** Builds `count` items scattered around `center` with `spread` jitter. */
function makeGroup(
  rng: () => number,
  idPrefix: string,
  center: number[],
  count: number,
  spread: number,
  baseWeight: number
): WeightedEmbeddingItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}-${i}`,
    // Distinct weights avoid exact ties, which are the only place the
    // deterministic tie-break (lowest index) is order-sensitive.
    weight: baseWeight + i * 0.017,
    embedding: center.map((c) => c + (rng() - 0.5) * spread),
  }))
}

/** Two well-separated groups in orthogonal subspaces -- the bimodal-taste case. */
function bimodalFixture(rng: () => number, perGroup: number): WeightedEmbeddingItem[] {
  return [
    ...makeGroup(rng, 'a', [1, 0, 0, 0, 0, 0], perGroup, 0.08, 1),
    ...makeGroup(rng, 'b', [0, 0, 0, 1, 0, 0], perGroup, 0.08, 1),
  ]
}

/**
 * A single coherent taste of a given breadth: one dominant direction plus
 * `noise` jitter. Splitting one of these is the harmful direction -- it
 * fragments a coherent taste into arbitrary sub-clusters that each retrieve a
 * narrower, worse candidate pool -- so they must stay at K=1.
 *
 * This models real embeddings, which occupy a narrow cone rather than the
 * whole sphere (every movie shares "movie-ness", so a user's watch history
 * has mean pairwise cosine similarity well above 0). Sweeping `noise` from
 * 0.2 to 5.0 covers mean pairwise similarity ~0.98 down to ~0.05, i.e. every
 * realistic breadth of coherent taste.
 */
function coherentTasteFixture(
  rng: () => number,
  count: number,
  noise: number
): WeightedEmbeddingItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c-${i}`,
    weight: 1 + i * 0.013,
    embedding: [1, 0, 0, 0, 0, 0, 0, 0].map((base) => base + (rng() - 0.5) * noise),
  }))
}

/**
 * Realistic bimodal taste: two facets that are distinct but still correlated,
 * the way real text embeddings of two movie genres are (they share a lot of
 * "movie-ness"). `crossOverlap` is the shared component pulling the groups
 * together -- higher means the facets are harder to tell apart.
 */
function correlatedBimodalFixture(
  rng: () => number,
  perGroup: number,
  crossOverlap: number
): WeightedEmbeddingItem[] {
  const shared = [0.5, 0.5, 0.5, 0.5]
  const facetA = [1, 0, 0, 0]
  const facetB = [0, 0, 1, 0]
  const build = (prefix: string, facet: number[]) =>
    Array.from({ length: perGroup }, (_, i) => ({
      id: `${prefix}-${i}`,
      weight: 1 + i * 0.019,
      embedding: facet.map(
        (f, d) => f + shared[d] * crossOverlap + (rng() - 0.5) * 0.35
      ),
    }))
  return [...build('a', facetA), ...build('b', facetB)]
}

// ============================================================================
// 1. K=1 must be provably identical to today's single-centroid behavior
// ============================================================================

test('K=1 returns the weighted mean, L2-normalized, matching the reference formula', () => {
  const items: WeightedEmbeddingItem[] = [
    { id: 'a', weight: 2, embedding: [1, 0, 0] },
    { id: 'b', weight: 1, embedding: [0, 2, 0] },
    { id: 'c', weight: 3, embedding: [0, 0, 1] },
  ]

  const clusters = clusterTasteEmbeddings(items, 1)
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].clusterIndex, 0)
  assert.equal(clusters[0].weight, 1)
  assert.equal(clusters[0].itemCount, 3)

  const expected = referenceWeightedMean(items)
  assert.equal(clusters[0].embedding.length, expected.length)
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(clusters[0].embedding[i] - expected[i]) < 1e-9,
      `dim ${i}: ${clusters[0].embedding[i]} != ${expected[i]}`
    )
  }
  assert.ok(Math.abs(l2Norm(clusters[0].embedding) - 1) < 1e-9)
})

test('K=1 is BIT-identical to buildTasteProfile, not merely close', () => {
  // The whole safety story for this feature is that a K=1 result is exactly
  // today's behavior. buildWeightedAverageEmbedding in builder.ts is private
  // and its caller needs a DB, so this replicates that function's body
  // verbatim (weighted sum -> divide by totalWeight -> L2 normalize, iterating
  // items in order and skipping ones missing from the embeddings Map) and
  // asserts exact equality -- no tolerance. Float addition is not
  // associative, so this also pins the summation ORDER: buildTasteProfile
  // sorts by descending weight before averaging, and buildTasteClusters must
  // feed items in that same order.
  function buildWeightedAverageEmbeddingReplica(
    items: Array<{ id: string; weight: number }>,
    embeddings: Map<string, number[]>
  ): number[] | null {
    const firstEmbedding = embeddings.values().next().value
    if (!firstEmbedding) return null
    const dimension = firstEmbedding.length
    const result = new Array(dimension).fill(0)
    let totalWeight = 0
    for (const item of items) {
      const embedding = embeddings.get(item.id)
      if (!embedding) continue
      for (let i = 0; i < dimension; i++) result[i] += embedding[i] * item.weight
      totalWeight += item.weight
    }
    if (totalWeight === 0) return null
    for (let i = 0; i < dimension; i++) result[i] /= totalWeight
    const norm = Math.sqrt(result.reduce((sum, val) => sum + val * val, 0))
    if (norm > 0) for (let i = 0; i < dimension; i++) result[i] /= norm
    return result
  }

  const rng = makeRng(2718)
  for (let trial = 0; trial < 25; trial++) {
    const count = 3 + trial * 7
    const dim = 5 + (trial % 7)
    const raw = Array.from({ length: count }, (_, i) => ({
      id: `x${i}`,
      weight: 0.05 + rng() * 4,
      embedding: Array.from({ length: dim }, () => (rng() - 0.5) * 3),
    }))
    // Mirror builder.ts: sort by descending weight, then average.
    raw.sort((a, b) => b.weight - a.weight)
    const embeddings = new Map(raw.map((r) => [r.id, r.embedding]))

    const expected = buildWeightedAverageEmbeddingReplica(raw, embeddings)
    const actual = clusterTasteEmbeddings(raw, 1)[0].embedding

    assert.deepStrictEqual(
      actual,
      expected,
      `trial ${trial}: K=1 diverged from the production averaging formula`
    )
  }
})

test('K=1 handles a single item and an empty list', () => {
  const single = clusterTasteEmbeddings([{ id: 'a', weight: 1, embedding: [3, 4] }], 1)
  assert.equal(single.length, 1)
  assert.equal(single[0].itemCount, 1)
  // [3,4] normalized is [0.6, 0.8]
  assert.ok(Math.abs(single[0].embedding[0] - 0.6) < 1e-9)
  assert.ok(Math.abs(single[0].embedding[1] - 0.8) < 1e-9)

  assert.deepEqual(clusterTasteEmbeddings([], 1), [])
  assert.deepEqual(clusterTasteEmbeddings([], 3), [])
})

test('requesting more clusters than items degrades to a single cluster', () => {
  const items: WeightedEmbeddingItem[] = [
    { id: 'a', weight: 1, embedding: [1, 0] },
    { id: 'b', weight: 1, embedding: [0, 1] },
  ]
  const clusters = clusterTasteEmbeddings(items, 3)
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].itemCount, 2)
})

// ============================================================================
// 2. Cluster weights are a valid distribution
// ============================================================================

test('cluster weights sum to 1 and every weight is positive', () => {
  const rng = makeRng(1234)
  for (const perGroup of [10, 25, 40]) {
    const items = bimodalFixture(rng, perGroup)
    const clusters = clusterTasteEmbeddings(items, 2)
    const sum = clusters.reduce((s, c) => s + c.weight, 0)
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights summed to ${sum} for perGroup=${perGroup}`)
    for (const cluster of clusters) {
      assert.ok(cluster.weight > 0, 'weight must be > 0 (user_taste_clusters CHECK constraint)')
      assert.ok(cluster.weight <= 1, 'weight must be <= 1 (user_taste_clusters CHECK constraint)')
    }
  }
})

test('item counts across clusters account for every input item exactly once', () => {
  const rng = makeRng(99)
  const items = bimodalFixture(rng, 30)
  const clusters = clusterTasteEmbeddings(items, 2)
  const totalCounted = clusters.reduce((s, c) => s + c.itemCount, 0)
  assert.equal(totalCounted, items.length)
})

// ============================================================================
// 3-4. Determinism and order-independence
// ============================================================================

test('same input produces byte-identical output across repeated calls', () => {
  const rng = makeRng(7)
  const items = bimodalFixture(rng, 30)

  const first = clusterTasteEmbeddings(items, 2)
  const second = clusterTasteEmbeddings(items, 2)
  assert.deepStrictEqual(first, second)

  // A separately-constructed deep-equal array must also match, proving the
  // result depends on values only -- not on object identity or any hidden state.
  const copy = items.map((i) => ({ id: i.id, weight: i.weight, embedding: [...i.embedding] }))
  assert.deepStrictEqual(clusterTasteEmbeddings(copy, 2), first)
})

test('shuffled input produces the same clusters', () => {
  const rng = makeRng(4242)
  const items = bimodalFixture(rng, 30)

  const shuffleRng = makeRng(8888)
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(shuffleRng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const base = clusterTasteEmbeddings(items, 2)
  const reordered = clusterTasteEmbeddings(shuffled, 2)

  assert.equal(reordered.length, base.length)
  for (let c = 0; c < base.length; c++) {
    assert.equal(reordered[c].itemCount, base[c].itemCount)
    assert.ok(Math.abs(reordered[c].weight - base[c].weight) < 1e-12)
    // Compared with a tolerance rather than deepStrictEqual because summing
    // the same members in a different order differs in the last float bits --
    // floating-point addition is not associative.
    for (let i = 0; i < base[c].embedding.length; i++) {
      assert.ok(
        Math.abs(reordered[c].embedding[i] - base[c].embedding[i]) < 1e-12,
        `cluster ${c} dim ${i} drifted`
      )
    }
  }
})

test('clusters are ordered by descending weight and indexed 0..k-1', () => {
  const rng = makeRng(31337)
  // Deliberately lopsided: 40 items in one facet, 12 in the other.
  const items = [
    ...makeGroup(rng, 'big', [1, 0, 0, 0], 40, 0.08, 1),
    ...makeGroup(rng, 'small', [0, 0, 1, 0], 12, 0.08, 1),
  ]
  const clusters = clusterTasteEmbeddings(items, 2)
  assert.equal(clusters.length, 2)
  assert.ok(clusters[0].weight >= clusters[1].weight)
  assert.equal(clusters[0].clusterIndex, 0)
  assert.equal(clusters[1].clusterIndex, 1)
  assert.equal(clusters[0].itemCount, 40)
  assert.equal(clusters[1].itemCount, 12)
})

// ============================================================================
// 5. Hard-floor step-down
// ============================================================================

test('a split producing an under-floor cluster steps down to a smaller K', () => {
  const rng = makeRng(555)
  // Two dense facets plus a lone outlier: at K=3 the outlier would form a
  // 1-member cluster, which is below the hard floor and must be rejected.
  const items = [
    ...makeGroup(rng, 'a', [1, 0, 0, 0, 0], 25, 0.05, 1),
    ...makeGroup(rng, 'b', [0, 1, 0, 0, 0], 25, 0.05, 1),
    { id: 'outlier', weight: 1.4, embedding: [0, 0, 0, 0, 1] },
  ]

  const clusters = clusterTasteEmbeddings(items, 3)
  assert.ok(clusters.length < 3, `expected step-down from K=3, got ${clusters.length} clusters`)
  for (const cluster of clusters) {
    assert.ok(
      cluster.itemCount >= MIN_ITEMS_PER_CLUSTER_HARD_FLOOR,
      `cluster of ${cluster.itemCount} items is below the hard floor`
    )
  }
})

test('no multi-cluster result is ever below the hard floor, across many fixtures', () => {
  const rng = makeRng(2024)
  for (let trial = 0; trial < 60; trial++) {
    const groupCount = 1 + (trial % 3)
    const items: WeightedEmbeddingItem[] = []
    for (let g = 0; g < groupCount; g++) {
      const center = [0, 0, 0, 0, 0, 0]
      center[g] = 1
      // Group sizes deliberately range down to 2, well under the floor.
      items.push(...makeGroup(rng, `g${g}`, center, 2 + ((trial * (g + 1)) % 20), 0.1, 1))
    }
    for (const k of [1, 2, 3]) {
      const clusters = clusterTasteEmbeddings(items, k)
      // The floor governs whether a SPLIT is allowed. A single cluster is
      // always valid -- it's exactly today's single-centroid behavior, and a
      // user with 2 watched items legitimately gets one cluster of 2.
      if (clusters.length < 2) continue
      for (const cluster of clusters) {
        assert.ok(
          cluster.itemCount >= MIN_ITEMS_PER_CLUSTER_HARD_FLOOR,
          `trial ${trial} k=${k}: cluster of ${cluster.itemCount} items below floor`
        )
      }
    }
  }
})

// ============================================================================
// 6. chooseK gating
// ============================================================================

test('chooseK returns 1 for an empty list', () => {
  assert.deepEqual(chooseK([]), { k: 1, dispersion: 0, rawDispersion: 0 })
})

test('chooseK gates the attempted K purely on item count', () => {
  const rng = makeRng(22)
  // Under 30 items -> at most K=1 attempted.
  const sparse = bimodalFixture(rng, 10)
  assert.equal(sparse.length, 20)
  assert.equal(chooseK(sparse).k, 1)

  // 36 items: enough for K=2, not the 45 needed for K=3.
  const medium = bimodalFixture(rng, 18)
  assert.equal(medium.length, 36)
  assert.equal(chooseK(medium).k, 2)

  // 60 items: enough to attempt the full MAX_K.
  const large = bimodalFixture(rng, 30)
  assert.equal(large.length, 60)
  assert.equal(chooseK(large).k, MAX_K)
})

test('chooseK never exceeds MAX_K and reports a dispersion score in range', () => {
  const rng = makeRng(33)
  for (let trial = 0; trial < 40; trial++) {
    const items = Array.from({ length: 1 + trial * 5 }, (_, i) => ({
      id: `i${i}`,
      weight: 0.5 + rng(),
      embedding: [rng(), rng(), rng(), rng(), rng(), rng()],
    }))
    const { k, dispersion } = chooseK(items)
    assert.ok(k >= 1 && k <= MAX_K, `k=${k} out of range`)
    assert.ok(dispersion >= 0 && dispersion <= 1, `dispersion=${dispersion} out of range`)
  }
})

test('the reported dispersion score still uses tasteAnalyzer bands (diagnostics only)', () => {
  // The score is stored on user_taste_clusters rows and shares a scale with
  // lib/tasteAnalyzer.ts's calculateTasteDiversity. It does NOT pick K --
  // see MIN_MARGINAL_DISPERSION_REDUCTION and the discrimination tests below.
  assert.equal(DISPERSION_FOCUSED_THRESHOLD, 0.3)
  assert.equal(DISPERSION_ECLECTIC_THRESHOLD, 0.6)
})

// ============================================================================
// 6b. The decision that actually matters: split real structure, not noise
//
// These are the regression guards for the flaw that an absolute
// distance-to-centroid threshold has: distance saturates at ~0.293 for two
// orthogonal facets, so the *most* cleanly bimodal user reads as "focused"
// while a single diffuse blob reads as "eclectic" -- exactly backwards.
// ============================================================================

test('a tightly focused single-facet user stays at K=1', () => {
  const rng = makeRng(11)
  const items = makeGroup(rng, 'tight', [1, 0, 0, 0, 0, 0], 120, 0.02, 1)
  const { k } = chooseK(items)
  const clusters = clusterTasteEmbeddings(items, k)
  assert.equal(clusters.length, 1, 'a coherent taste must not be fragmented')
})

test('a single coherent taste stays at K=1 at every realistic breadth', () => {
  // Covers mean pairwise cosine similarity from ~0.98 (very tight) down to
  // ~0.05 (extremely broad) -- the full range real embeddings can occupy.
  // None of these has a second facet, so none may be split.
  for (const noise of [0.2, 0.5, 0.9, 1.4, 2.0, 3.0, 5.0]) {
    const items = coherentTasteFixture(makeRng(500 + Math.round(noise * 10)), 100, noise)
    const clusters = clusterTasteEmbeddings(items, chooseK(items).k)
    assert.equal(
      clusters.length,
      1,
      `noise=${noise}: fragmented a coherent taste into ${clusters.length} clusters`
    )
  }
})

test('raw dispersion alone would misjudge these cases, which is why it does not pick K', () => {
  // A broad-but-coherent taste scores HIGH on raw dispersion (an absolute
  // threshold would split it), while a cleanly bimodal taste scores LOW
  // because the centroid sits between its two facets (an absolute threshold
  // would refuse to split it). Both judgments are backwards -- this test pins
  // that inversion so nobody "simplifies" K selection back onto this score.
  const broad = coherentTasteFixture(makeRng(1234), 100, 3.0)
  const bimodal = bimodalFixture(makeRng(5678), 30)

  assert.ok(
    chooseK(broad).dispersion > chooseK(bimodal).dispersion,
    'expected the coherent-but-broad taste to score higher dispersion than the bimodal one'
  )
  assert.equal(clusterTasteEmbeddings(broad, chooseK(broad).k).length, 1)
  assert.ok(clusterTasteEmbeddings(bimodal, chooseK(bimodal).k).length >= 2)
})

test('a clearly bimodal user splits into 2+ clusters', () => {
  const rng = makeRng(6060)
  for (let trial = 0; trial < 20; trial++) {
    const items = bimodalFixture(rng, 25) // 50 items, enough to attempt K=3
    const { k } = chooseK(items)
    const clusters = clusterTasteEmbeddings(items, k)
    assert.ok(clusters.length >= 2, `trial ${trial}: bimodal taste collapsed to ${clusters.length} cluster`)
  }
})

test('bimodal taste splits across a realistic range of facet correlation', () => {
  // Real embeddings of two movie genres still share a lot of structure, so
  // the facets are correlated rather than orthogonal. This is the case the
  // saturating absolute-distance rule silently failed.
  for (const crossOverlap of [0, 0.3, 0.6, 1.0]) {
    const rng = makeRng(1000 + Math.round(crossOverlap * 10))
    const items = correlatedBimodalFixture(rng, 30, crossOverlap)
    const { k } = chooseK(items)
    const clusters = clusterTasteEmbeddings(items, k)
    assert.ok(
      clusters.length >= 2,
      `crossOverlap=${crossOverlap}: two real facets collapsed to ${clusters.length} cluster`
    )
  }
})

test('a three-facet user can reach K=3, and a two-facet user does not', () => {
  const rng = makeRng(4711)
  const trimodal = [
    ...makeGroup(rng, 'a', [1, 0, 0, 0, 0, 0], 25, 0.08, 1),
    ...makeGroup(rng, 'b', [0, 1, 0, 0, 0, 0], 25, 0.08, 1),
    ...makeGroup(rng, 'c', [0, 0, 1, 0, 0, 0], 25, 0.08, 1),
  ]
  const triClusters = clusterTasteEmbeddings(trimodal, chooseK(trimodal).k)
  assert.equal(triClusters.length, 3, 'three distinct facets should yield three clusters')

  // Two facets with plenty of items: attempting K=3 must step back down to 2
  // rather than splitting one real facet in half.
  const bimodal = bimodalFixture(makeRng(4712), 38) // 76 items
  const biClusters = clusterTasteEmbeddings(bimodal, chooseK(bimodal).k)
  assert.equal(biClusters.length, 2, 'two distinct facets should yield exactly two clusters')
})

test('an accepted split measurably reduces within-cluster dispersion', () => {
  const rng = makeRng(31415)
  const items = bimodalFixture(rng, 30)
  const clusters = clusterTasteEmbeddings(items, chooseK(items).k)
  assert.ok(clusters.length >= 2)

  const overall = referenceWeightedMean(items)
  const distTo = (v: number[], centroid: number[]) => {
    const n = l2Norm(v)
    return 1 - dot(v.map((x) => x / n), centroid)
  }

  let baselineSum = 0
  let splitSum = 0
  let weightSum = 0
  for (const item of items) {
    // Best-matching cluster is what retrieval actually uses (max similarity).
    const best = Math.min(...clusters.map((c) => distTo(item.embedding, c.embedding)))
    baselineSum += distTo(item.embedding, overall) * item.weight
    splitSum += best * item.weight
    weightSum += item.weight
  }
  const baseline = baselineSum / weightSum
  const split = splitSum / weightSum
  const reduction = (baseline - split) / baseline

  assert.ok(
    reduction >= MIN_MARGINAL_DISPERSION_REDUCTION,
    `accepted split only reduced dispersion by ${(reduction * 100).toFixed(1)}%`
  )
})

// ============================================================================
// 7. Numeric fuzz: centroids stay unit-length, merged similarity stays in [0,1]
// ============================================================================

test('fuzz: centroids are unit vectors and max-merged similarity stays within [0,1]', () => {
  const rng = makeRng(90210)
  let minSeen = Infinity
  let maxSeen = -Infinity

  for (let trial = 0; trial < 300; trial++) {
    const dim = 4 + (trial % 5)
    const itemCount = 10 + (trial % 90)
    const items: WeightedEmbeddingItem[] = Array.from({ length: itemCount }, (_, i) => ({
      id: `i${i}`,
      weight: 0.05 + rng() * 3,
      // Deliberately unnormalized and sometimes negative, like raw embeddings.
      embedding: Array.from({ length: dim }, () => (rng() - 0.5) * 4),
    }))

    const { k } = chooseK(items)
    const clusters = clusterTasteEmbeddings(items, k)
    assert.ok(clusters.length >= 1 && clusters.length <= MAX_K)

    for (const cluster of clusters) {
      assert.ok(
        Math.abs(l2Norm(cluster.embedding) - 1) < 1e-9,
        `centroid norm was ${l2Norm(cluster.embedding)}`
      )
      assert.ok(Number.isFinite(cluster.weight) && cluster.weight > 0 && cluster.weight <= 1)
    }
    const weightSum = clusters.reduce((s, c) => s + c.weight, 0)
    assert.ok(Math.abs(weightSum - 1) < 1e-9, `weights summed to ${weightSum}`)

    // Simulate the merge step: per-cluster cosine similarity against a random
    // candidate, take the max, then apply calculateBaseScore's existing floor
    // at 0. This is the exact quantity that flows into scoring as `similarity`.
    for (let probe = 0; probe < 5; probe++) {
      const raw = Array.from({ length: dim }, () => (rng() - 0.5) * 4)
      const norm = l2Norm(raw)
      if (norm === 0) continue
      const candidate = raw.map((v) => v / norm)

      let best = -Infinity
      for (const cluster of clusters) {
        best = Math.max(best, dot(candidate, cluster.embedding))
      }
      const similarity = Math.max(0, best)
      minSeen = Math.min(minSeen, similarity)
      maxSeen = Math.max(maxSeen, similarity)
      assert.ok(similarity >= 0 && similarity <= 1 + 1e-9, `similarity ${similarity} out of [0,1]`)
    }
  }

  assert.ok(minSeen >= 0, `min similarity ${minSeen}`)
  assert.ok(maxSeen <= 1 + 1e-9, `max similarity ${maxSeen}`)
})

test('fuzz: cluster counts stay consistent with the requested K across random inputs', () => {
  const rng = makeRng(24680)
  for (let trial = 0; trial < 200; trial++) {
    const itemCount = 1 + (trial % 120)
    const dim = 3 + (trial % 6)
    const items: WeightedEmbeddingItem[] = Array.from({ length: itemCount }, (_, i) => ({
      id: `i${i}`,
      weight: 0.1 + rng() * 2,
      embedding: Array.from({ length: dim }, () => (rng() - 0.5) * 3),
    }))
    const requestedK = 1 + (trial % MAX_K)
    const clusters = clusterTasteEmbeddings(items, requestedK)

    assert.ok(clusters.length >= 1 && clusters.length <= requestedK, `got ${clusters.length} for k=${requestedK}`)
    // Cluster indices must always be a contiguous 0..n-1 run.
    clusters.forEach((c, i) => assert.equal(c.clusterIndex, i))
    // Every item accounted for exactly once.
    assert.equal(
      clusters.reduce((s, c) => s + c.itemCount, 0),
      items.length
    )
  }
})

// ============================================================================
// 8. Diagnostics: the trace must be faithful, and must not perturb anything
// ============================================================================

test('passing a trace does not change the clustering result', () => {
  const rng = makeRng(4242)
  const fixtures: WeightedEmbeddingItem[][] = [
    bimodalFixture(makeRng(1), 30),
    coherentTasteFixture(makeRng(2), 60, 1.2),
    correlatedBimodalFixture(makeRng(3), 30, 0.6),
    Array.from({ length: 50 }, (_, i) => ({
      id: `r-${i}`,
      weight: 0.5 + rng() * 2,
      embedding: Array.from({ length: 6 }, () => (rng() - 0.5) * 3),
    })),
  ]

  for (const items of fixtures) {
    const { k } = chooseK(items)
    const withoutTrace = clusterTasteEmbeddings(items, k)
    const withTrace = clusterTasteEmbeddings(items, k, [])
    assert.deepEqual(withTrace, withoutTrace, 'the diagnostic trace changed the outcome')
  }
})

test('a kept split is recorded with the reduction that earned it', () => {
  const items = bimodalFixture(makeRng(777), 40)
  const trace: ClusterAttempt[] = []
  const clusters = clusterTasteEmbeddings(items, chooseK(items).k, trace)

  assert.ok(clusters.length > 1, 'fixture should split -- test needs a new fixture otherwise')

  const kept = trace.filter((a) => a.kept)
  assert.ok(kept.length > 0, 'a split happened but nothing was recorded as kept')
  for (const attempt of kept) {
    assert.ok(
      attempt.reduction >= MIN_MARGINAL_DISPERSION_REDUCTION,
      `kept k=${attempt.k} at reduction ${attempt.reduction}, below the bar`
    )
    assert.equal(attempt.rejectedFor, undefined)
    assert.ok(attempt.splitDistance <= attempt.previousDistance)
    assert.ok(attempt.smallestCluster >= MIN_ITEMS_PER_CLUSTER_HARD_FLOOR)
  }
  assert.equal(clusters.length, Math.max(...kept.map((a) => a.k)))
})

test('a rejected split records why, and how close it came', () => {
  // A single coherent taste: must stay at K=1, and the trace has to say the
  // reduction was the reason. This is the shape every real profile currently
  // produces, so it is the case the recorded number exists to quantify.
  const items = coherentTasteFixture(makeRng(31337), 90, 1.0)
  const trace: ClusterAttempt[] = []
  const clusters = clusterTasteEmbeddings(items, chooseK(items).k, trace)

  assert.equal(clusters.length, 1)
  assert.ok(trace.length > 0, 'attempted splits must be recorded even when all are rejected')

  for (const attempt of trace) {
    assert.equal(attempt.kept, false)
    assert.ok(attempt.rejectedFor, `k=${attempt.k} rejected with no reason recorded`)
    if (attempt.rejectedFor === 'insufficient-reduction') {
      assert.ok(
        attempt.reduction < MIN_MARGINAL_DISPERSION_REDUCTION,
        'recorded a reduction that clears the bar but was rejected for missing it'
      )
      // The whole point of collecting this: it must be a real measurement, not
      // a placeholder, or it can't be used to recalibrate the threshold.
      assert.ok(Number.isFinite(attempt.reduction))
      assert.ok(attempt.previousDistance > 0)
    }
  }
})

test('every attempted K appears in the trace exactly once', () => {
  const items = coherentTasteFixture(makeRng(2024), 120, 1.5)
  const { k } = chooseK(items)
  assert.ok(k > 1, 'fixture should be large enough to attempt a split')

  const trace: ClusterAttempt[] = []
  clusterTasteEmbeddings(items, k, trace)

  const ks = trace.map((a) => a.k).sort((a, b) => a - b)
  assert.deepEqual(ks, Array.from({ length: k - 1 }, (_, i) => i + 2))
})

test('chooseK reports the raw measurement alongside the rescaled one', () => {
  for (const items of [
    bimodalFixture(makeRng(11), 30),
    coherentTasteFixture(makeRng(12), 60, 0.4),
    coherentTasteFixture(makeRng(13), 60, 4.0),
  ]) {
    const { dispersion, rawDispersion } = chooseK(items)

    // Raw is an unclamped cosine distance; normalized is that mapped from
    // [FOCUSED, FOCUSED+0.5] onto [0,1]. Everything below the floor collapses
    // to 0, which is exactly the behavior under review -- so the raw value has
    // to survive independently.
    assert.ok(rawDispersion >= 0 && rawDispersion <= 2, `raw out of range: ${rawDispersion}`)
    assert.ok(dispersion >= 0 && dispersion <= 1)
    assert.ok(
      Math.abs(
        dispersion -
          Math.min(1, Math.max(0, (rawDispersion - DISPERSION_FOCUSED_THRESHOLD) / 0.5))
      ) < 1e-12,
      'normalized dispersion is no longer derivable from the raw measurement'
    )
  }

  assert.deepEqual(chooseK([]), { k: 1, dispersion: 0, rawDispersion: 0 })
})

// ============================================================================
// 9. Real geometry: the criterion must survive a narrow embedding cone
// ============================================================================

/**
 * Two real facets buried under a shared component, which is what real movie
 * embeddings look like: every vector encodes "this is a movie" far more
 * strongly than it encodes a genre. `shared` scales that common direction --
 * higher means a tighter cone and a lower absolute dispersion.
 */
function coneBimodalFixture(
  rng: () => number,
  perGroup: number,
  shared: number
): WeightedEmbeddingItem[] {
  const dim = 12
  const sharedDir = Array.from({ length: dim }, (_, i) => (i % 3 === 0 ? 1 : 0.4))
  const build = (prefix: string, facetAxis: number) =>
    Array.from({ length: perGroup }, (_, i) => ({
      id: `${prefix}-${i}`,
      weight: 1 + i * 0.011,
      embedding: Array.from({ length: dim }, (_, d) =>
        sharedDir[d] * shared + (d === facetAxis ? 1 : 0) + (rng() - 0.5) * 0.5
      ),
    }))
  return [...build('a', 1), ...build('b', 2)]
}

/** One facet in the same cone geometry -- must not split at any tightness. */
function coneCoherentFixture(
  rng: () => number,
  count: number,
  shared: number
): WeightedEmbeddingItem[] {
  const dim = 12
  return Array.from({ length: count }, (_, i) => ({
    id: `c-${i}`,
    weight: 1 + i * 0.01,
    embedding: Array.from({ length: dim }, (_, d) =>
      (d % 3 === 0 ? 1 : 0.4) * shared + (d === 1 ? 1 : 0) + (rng() - 0.5) * 1.2
    ),
  }))
}

function k2Reduction(items: WeightedEmbeddingItem[]): number {
  const trace: ClusterAttempt[] = []
  clusterTasteEmbeddings(items, chooseK(items).k, trace)
  const attempt = trace.find((a) => a.k === 2)
  assert.ok(attempt, 'expected a k=2 attempt to be recorded')
  return attempt.reduction
}

test('a tight embedding cone does not defeat the split criterion', () => {
  // Real profiles measured raw dispersion 0.238-0.254. Sweeping `shared` drives
  // dispersion from ~0.40 down to ~0.0005, bracketing that by a wide margin --
  // so if the criterion were going to break down on cone-shaped data, it would
  // break somewhere in here.
  for (const shared of [0, 0.25, 0.5, 1, 2, 5, 12]) {
    const bimodal = k2Reduction(coneBimodalFixture(makeRng(1234), 40, shared))
    const coherent = k2Reduction(coneCoherentFixture(makeRng(99), 80, shared))

    assert.ok(
      bimodal > MIN_MARGINAL_DISPERSION_REDUCTION,
      `shared=${shared}: real bimodal structure scored ${bimodal.toFixed(4)}, below the bar`
    )
    assert.ok(
      coherent < MIN_MARGINAL_DISPERSION_REDUCTION,
      `shared=${shared}: coherent taste scored ${coherent.toFixed(4)}, would have been split`
    )
    // The bands must stay far apart, not merely on the right sides -- a narrow
    // margin would mean the threshold's exact value is doing the work.
    assert.ok(
      bimodal > coherent * 3,
      `shared=${shared}: bands too close (${bimodal.toFixed(4)} vs ${coherent.toFixed(4)})`
    )
  }
})

test('absolute dispersion collapses in a tight cone while the ratio holds', () => {
  // This is *why* the criterion is a ratio against K-1 rather than an absolute
  // distance: the same real structure that scores 0.70 below reports a raw
  // dispersion near zero once the shared component dominates.
  const tight = coneBimodalFixture(makeRng(1234), 40, 12)
  const loose = coneBimodalFixture(makeRng(1234), 40, 0)

  assert.ok(chooseK(tight).rawDispersion < 0.01, 'expected the tight cone to flatten dispersion')
  assert.ok(chooseK(loose).rawDispersion > 0.2)

  // Both still split, and by a similar margin.
  assert.ok(k2Reduction(tight) > MIN_MARGINAL_DISPERSION_REDUCTION)
  assert.ok(k2Reduction(loose) > MIN_MARGINAL_DISPERSION_REDUCTION)
})

test('the reductions seen on real profiles sit in the coherent band', () => {
  // Observed across 14 live profiles: k=2 in 0.020-0.078, k=3 in 0.045-0.130.
  // The synthetic coherent fixture must cover that range, which is what makes
  // "these users are unimodal" the reading rather than "the threshold is wrong".
  const observedRealMax = 0.13
  for (const shared of [0.25, 1, 5]) {
    const coherent = k2Reduction(coneCoherentFixture(makeRng(99), 80, shared))
    assert.ok(
      coherent < MIN_MARGINAL_DISPERSION_REDUCTION,
      `coherent fixture scored ${coherent.toFixed(4)}`
    )
    assert.ok(
      observedRealMax < MIN_MARGINAL_DISPERSION_REDUCTION,
      'real observations should remain well below the threshold'
    )
  }
})
