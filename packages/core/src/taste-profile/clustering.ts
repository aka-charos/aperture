/**
 * Taste Cluster Clustering
 *
 * Pure, DB-free math -- no imports from other taste-profile modules, so this
 * has zero risk of circular imports with builder.ts/index.ts, which both
 * import FROM here.
 *
 * A single averaged taste vector dilutes a user with more than one distinct
 * taste facet (e.g. gritty crime dramas AND whimsical animated comedies) into
 * a "semantic middle" that isn't a good match for either. This module splits
 * engagement-weighted watch history into 1-3 taste clusters instead, each
 * usable as its own pgvector query vector during candidate retrieval.
 *
 * Fully deterministic -- no RNG anywhere. Centroid seeding is a deterministic
 * farthest-point traversal, ties break to the lowest index, and empty-cluster
 * recovery deterministically reseeds from the single worst-fit point. Same
 * input always produces byte-identical output, which matters because
 * profiles rebuild periodically (see taste-profile/index.ts staleness
 * handling) and label-switching / reinitialization noise would otherwise make
 * recommendations feel unstable across rebuilds.
 */

export interface WeightedEmbeddingItem {
  id: string
  weight: number
  embedding: number[]
}

export interface ClusterCentroid {
  clusterIndex: number
  embedding: number[]
  weight: number
  itemCount: number
}

/** Matches the existing maxEnrichedCandidates precedent in discover/types.ts rather than inventing a new magic number. */
export const MAX_CLUSTERING_INPUT_ITEMS = 150
export const MAX_K = 3
export const MAX_LLOYD_ITERATIONS = 25

/** Soft pre-check: don't attempt K clusters without at least this many items per prospective cluster. */
export const MIN_ITEMS_PER_CLUSTER_SOFT_TARGET = 15
/** Hard post-check: a converged cluster below this size is statistically unstable and gets discarded (recurse to K-1). */
export const MIN_ITEMS_PER_CLUSTER_HARD_FLOOR = 5

/**
 * Going from K-1 to K clusters is only accepted if it reduces the weighted
 * average distance from items to their nearest centroid by at least this
 * fraction *relative to the K-1 result*. Scale-free: it asks "does this extra
 * centroid explain structure the previous one missed?" rather than comparing
 * an absolute distance against a calibrated constant.
 *
 * Two things this gets right that the obvious alternatives don't:
 *
 * 1. It is measured against K-1, not against the single overall centroid.
 *    More clusters always reduce distance, so a K-vs-1 comparison is
 *    monotonic in K and would wave through the largest K every time.
 *
 * 2. It deliberately does NOT reuse lib/tasteAnalyzer.ts's focused/balanced/
 *    eclectic dispersion bands (0.3/0.6) for the K decision, even though this
 *    module still reports a score on that scale for storage/diagnostics.
 *    Those bands were calibrated to *label* taste in AI prompt text, and are
 *    non-monotonic in what matters here: distance-to-centroid saturates at
 *    ~0.293 for two perfectly orthogonal facets (the centroid sits at 45
 *    degrees between them), so the most cleanly bimodal user possible scores
 *    as "focused" while a single diffuse blob scores higher and reads as
 *    "eclectic" -- exactly backwards for deciding whether to split.
 *
 * 0.4 sits in the middle of a wide empirical gap measured over synthetic
 * fixtures: genuinely multi-facet data yields 54-99% marginal reduction at
 * the K matching its real facet count, while structureless data (a uniform
 * blob, or a single wide/tight group) tops out around 33%. Worth re-checking
 * against real watch histories -- erring low fragments coherent taste, which
 * is the harmful direction; erring high just falls back to today's behavior.
 */
export const MIN_MARGINAL_DISPERSION_REDUCTION = 0.4

/**
 * What one attempted K decided, and why. Purely diagnostic: clusterTasteEmbeddings
 * fills a caller-supplied array so the numbers behind a K choice can be logged
 * without this module taking a logger dependency -- it has no imports at all,
 * which is what lets lib/tasteAnalyzer.ts and lib/userAlgorithmSettings.ts
 * import from it with no risk of a cycle.
 *
 * Recorded because 0.4 above was calibrated on synthetic fixtures and the first
 * real instance produced K=1 for all 13 profiles. Whether that is correct or
 * the threshold is simply too high is not answerable without seeing the
 * reductions real watch histories actually achieve.
 */
export interface ClusterAttempt {
  k: number
  /** Weighted mean cosine distance to the nearest of the K-1 centroids. */
  previousDistance: number
  /** The same measure for the K centroids just fitted. */
  splitDistance: number
  /** (previous - split) / previous, i.e. what MIN_MARGINAL_DISPERSION_REDUCTION gates. */
  reduction: number
  /** Members in the smallest fitted cluster, against MIN_ITEMS_PER_CLUSTER_HARD_FLOOR. */
  smallestCluster: number
  kept: boolean
  rejectedFor?: 'kmeans-failed' | 'cluster-too-small' | 'insufficient-reduction'
}

/**
 * Cut points for labelling a dispersion score. Reported for diagnostics, not
 * used to pick K (see MIN_MARGINAL_DISPERSION_REDUCTION). lib/tasteAnalyzer.ts
 * imports these rather than repeating the literals, and getSmartDiversityWeight
 * keys its ×0.7 / ×1.2 adjustments off the same two numbers.
 */
export const DISPERSION_FOCUSED_THRESHOLD = 0.3
export const DISPERSION_ECLECTIC_THRESHOLD = 0.6

/**
 * Label a dispersion score. Kept beside the cut points so the bands and the
 * words describing them can't drift apart -- this module is a pure leaf with
 * no imports of its own, so anything may depend on it.
 */
export function describeDispersion(score: number): 'focused' | 'balanced' | 'eclectic' {
  if (score < DISPERSION_FOCUSED_THRESHOLD) return 'focused'
  if (score < DISPERSION_ECLECTIC_THRESHOLD) return 'balanced'
  return 'eclectic'
}

// ============================================================================
// Vector primitives
// ============================================================================

function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  if (norm === 0) return vector.slice()
  return vector.map((v) => v / norm)
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Weighted mean of raw (not necessarily normalized) embeddings, then
 * L2-normalized. Deliberately a standalone copy of the formula in
 * taste-profile/builder.ts's private buildWeightedAverageEmbedding (same
 * weighted-sum / totalWeight / L2-normalize steps) rather than importing it
 * from there -- builder.ts imports FROM this module (to call
 * clusterTasteEmbeddings), so importing back would be circular, and
 * builder.ts's buildTasteProfile() must stay byte-for-byte unchanged rather
 * than being refactored to share this helper.
 */
function weightedMeanEmbedding(items: WeightedEmbeddingItem[]): number[] | null {
  if (items.length === 0) return null

  const dimension = items[0].embedding.length
  const sum = new Array(dimension).fill(0)
  let totalWeight = 0

  for (const item of items) {
    for (let i = 0; i < dimension; i++) {
      sum[i] += item.embedding[i] * item.weight
    }
    totalWeight += item.weight
  }

  if (totalWeight === 0) return null

  for (let i = 0; i < dimension; i++) {
    sum[i] /= totalWeight
  }

  return l2Normalize(sum)
}

// ============================================================================
// K selection
// ============================================================================

/**
 * Weighted average cosine distance from each item to its *nearest* centroid.
 * With one centroid this is plain dispersion; with several it measures how
 * well the cluster set as a whole covers the items -- which is exactly what
 * retrieval does downstream, since merged candidate similarity takes the max
 * over centroids (see mergeClusterCandidatesByMaxSimilarity).
 */
function avgDistanceToNearestCentroid(
  items: WeightedEmbeddingItem[],
  centroids: number[][]
): number {
  if (centroids.length === 0) return 0

  let weightedDistanceSum = 0
  let totalWeight = 0
  for (const item of items) {
    const unit = l2Normalize(item.embedding)
    let nearest = Infinity
    for (const centroid of centroids) {
      const distance = 1 - dotProduct(unit, centroid)
      if (distance < nearest) nearest = distance
    }
    weightedDistanceSum += nearest * item.weight
    totalWeight += item.weight
  }
  return totalWeight > 0 ? weightedDistanceSum / totalWeight : 0
}

/**
 * Taste-dispersion score in [0,1] on the same scale as lib/tasteAnalyzer.ts's
 * calculateTasteDiversity, computed in-memory from the same
 * engagement-weighted items being clustered (rather than tasteAnalyzer's
 * independent, unweighted, differently-sampled SQL centroid).
 *
 * Reported for storage/diagnostics only -- K is chosen by the variance
 * reduction a split actually achieves, not by this score. See
 * MIN_DISPERSION_REDUCTION for why.
 */
function normalizeDispersion(rawDispersion: number): number {
  // Typical cosine distances in this embedding space were assumed to run
  // ~0.3-0.8 (the window tasteAnalyzer.ts calibrated against) -- rescale to
  // 0-1. That assumption is under review: see calculateRawDispersion.
  return Math.min(1, Math.max(0, (rawDispersion - DISPERSION_FOCUSED_THRESHOLD) / 0.5))
}

/**
 * The dispersion measurement before any rescaling: weighted mean cosine
 * distance from each item to the single overall centroid.
 *
 * Split out because the rescaling above looks wrong against real data. Every
 * profile on the first instance to run this reported a normalized dispersion of
 * exactly 0.000, which is what happens when the raw value never reaches the
 * 0.3 floor of the range it is being mapped from -- and the note on
 * MIN_MARGINAL_DISPERSION_REDUCTION already observed that distance-to-centroid
 * saturates near 0.293 even for two perfectly orthogonal facets. Reporting the
 * raw number is how we find the range this embedding space actually occupies
 * instead of guessing a replacement.
 *
 * Nothing keys off this yet -- K is chosen from the relative reduction a split
 * achieves (see clusterTasteEmbeddings), which is scale-free and therefore
 * unaffected either way.
 */
export function calculateRawDispersion(items: WeightedEmbeddingItem[]): number {
  const centroid = weightedMeanEmbedding(items)
  if (!centroid) return 0
  return avgDistanceToNearestCentroid(items, [centroid])
}

/**
 * Pure. Returns the largest K worth *attempting* for this item set, gated
 * purely by sample size so K>1 is never attempted on a statistically
 * meaningless slice (e.g. 2 clusters of ~3 items each), plus the dispersion
 * score for storage/diagnostics.
 *
 * Whether a split at that K is actually *kept* is decided downstream by
 * clusterTasteEmbeddings, which requires both a real member count per cluster
 * (MIN_ITEMS_PER_CLUSTER_HARD_FLOOR) and a meaningful reduction in
 * within-cluster dispersion (MIN_DISPERSION_REDUCTION), stepping down toward
 * K=1 otherwise. So this returning 3 means "try up to 3", not "use 3".
 */
export function chooseK(items: WeightedEmbeddingItem[]): {
  k: number
  dispersion: number
  rawDispersion: number
} {
  if (items.length === 0) return { k: 1, dispersion: 0, rawDispersion: 0 }

  const rawDispersion = calculateRawDispersion(items)
  const dispersion = normalizeDispersion(rawDispersion)

  let desiredK = MAX_K
  while (desiredK > 1 && items.length < desiredK * MIN_ITEMS_PER_CLUSTER_SOFT_TARGET) {
    desiredK -= 1
  }

  return { k: desiredK, dispersion, rawDispersion }
}

// ============================================================================
// Spherical k-means
// ============================================================================

interface UnitItem {
  id: string
  weight: number
  unit: number[]
}

/**
 * Deterministic farthest-point ("greedy k-means++") seeding: first centroid
 * is the highest-engagement-weight item (ties -> lowest index, guaranteed by
 * strict `>` comparison over ascending index order); each subsequent
 * centroid is the unclustered point maximizing its minimum distance to all
 * already-chosen centroids. Trades the randomized algorithm's approximation
 * guarantee for full determinism, which is what this module needs.
 */
function initCentroidsGreedy(items: UnitItem[], k: number): number[] {
  const n = items.length

  let firstIdx = 0
  for (let i = 1; i < n; i++) {
    if (items[i].weight > items[firstIdx].weight) firstIdx = i
  }

  const chosen = [firstIdx]
  const minDistToChosen = new Array(n).fill(Infinity)

  while (chosen.length < k) {
    const lastChosen = items[chosen[chosen.length - 1]].unit
    for (let i = 0; i < n; i++) {
      const dist = 1 - dotProduct(items[i].unit, lastChosen)
      if (dist < minDistToChosen[i]) minDistToChosen[i] = dist
    }

    let nextIdx = -1
    let nextDist = -Infinity
    for (let i = 0; i < n; i++) {
      if (chosen.includes(i)) continue
      if (minDistToChosen[i] > nextDist) {
        nextDist = minDistToChosen[i]
        nextIdx = i
      }
    }
    if (nextIdx === -1) break // fewer distinct points than k; defensive, guarded by callers anyway
    chosen.push(nextIdx)
  }

  return chosen
}

function assignItemsToCentroids(items: UnitItem[], centroids: number[][]): number[] {
  return items.map((item) => {
    let best = 0
    let bestSim = -Infinity
    for (let c = 0; c < centroids.length; c++) {
      const sim = dotProduct(item.unit, centroids[c])
      if (sim > bestSim) {
        bestSim = sim
        best = c
      }
    }
    return best
  })
}

/**
 * Recomputes each cluster's centroid as the weighted mean of its assigned
 * members. If a cluster ends up with zero members, it's deterministically
 * reseeded from the single worst-fit point overall (largest distance to its
 * own currently-assigned centroid) rather than reinitialized randomly.
 * `assignments` is read-only here (used to look up "which old centroid was
 * point i closest to"); the returned `assignments` reflects any steals so
 * the caller's item-count tally and next-iteration stability check stay
 * consistent with which points actually ended up where.
 */
function recomputeCentroids(
  items: UnitItem[],
  assignments: number[],
  k: number,
  previousCentroids: number[][]
): { centroids: number[][]; assignments: number[] } {
  const workingAssignments = assignments.slice()
  const stolen = new Set<number>()
  const newCentroids: number[][] = []

  for (let c = 0; c < k; c++) {
    const memberIndices: number[] = []
    for (let i = 0; i < workingAssignments.length; i++) {
      if (workingAssignments[i] === c) memberIndices.push(i)
    }

    if (memberIndices.length === 0) {
      let worstIdx = -1
      let worstSim = Infinity
      for (let i = 0; i < items.length; i++) {
        if (stolen.has(i)) continue
        const refCentroid = previousCentroids[assignments[i]] ?? previousCentroids[0]
        const sim = dotProduct(items[i].unit, refCentroid)
        if (sim < worstSim) {
          worstSim = sim
          worstIdx = i
        }
      }
      if (worstIdx === -1) {
        // Every point already stolen by an earlier empty cluster this pass
        // (only possible when k exceeds the number of usable points) --
        // duplicate the previous centroid; the hard-floor check upstream
        // will collapse k downward next.
        newCentroids.push(previousCentroids[c] ?? items[0].unit.slice())
        continue
      }
      stolen.add(worstIdx)
      workingAssignments[worstIdx] = c
      newCentroids.push(items[worstIdx].unit.slice())
    } else {
      const members = memberIndices.map((i) => items[i])
      const mean = weightedMeanEmbedding(
        members.map((m) => ({ id: m.id, weight: m.weight, embedding: m.unit }))
      )
      newCentroids.push(mean ?? previousCentroids[c])
    }
  }

  return { centroids: newCentroids, assignments: workingAssignments }
}

function runSphericalKMeans(
  items: UnitItem[],
  k: number
): { assignments: number[]; centroids: number[][] } | null {
  const n = items.length
  if (n < k || k < 1) return null

  const seedIndices = initCentroidsGreedy(items, k)
  if (seedIndices.length < k) return null

  let centroids: number[][] = seedIndices.map((idx) => items[idx].unit.slice())
  let assignments: number[] = new Array(n).fill(-1)

  for (let iter = 0; iter < MAX_LLOYD_ITERATIONS; iter++) {
    const nextAssignments = assignItemsToCentroids(items, centroids)

    if (iter > 0 && arraysEqual(nextAssignments, assignments)) {
      assignments = nextAssignments
      break
    }
    assignments = nextAssignments

    const recomputed = recomputeCentroids(items, assignments, k, centroids)
    centroids = recomputed.centroids
    assignments = recomputed.assignments
  }

  // Final assignment pass against the centroids actually being returned. On a
  // converged run this is a no-op; when the iteration cap is hit instead, it's
  // what guarantees the caller's membership tally (item counts, cluster
  // weights, and the hard-floor check) describes the centroids it returns
  // rather than a half-step-stale assignment.
  return { assignments: assignItemsToCentroids(items, centroids), centroids }
}

// ============================================================================
// Public entry point
// ============================================================================

function buildSingleCluster(items: WeightedEmbeddingItem[]): ClusterCentroid[] {
  const centroid = weightedMeanEmbedding(items)
  if (!centroid) return []
  return [{ clusterIndex: 0, embedding: centroid, weight: 1, itemCount: items.length }]
}

/**
 * Pure. `items.length === 0` -> `[]`. `k <= 1` (or fewer items than k) ->
 * closed-form weighted mean, no iteration -- calling this with k=1 on the
 * FULL, uncapped item list (the caller's responsibility, see
 * builder.ts's buildTasteClusters) is what makes "K=1 == today's
 * single-centroid behavior" provable rather than approximate. `k >= 2` ->
 * deterministic spherical k-means; if the actual converged result violates
 * MIN_ITEMS_PER_CLUSTER_HARD_FLOOR, recurses to k-1 (always terminates at
 * k=1, which never fails that check).
 */
export function clusterTasteEmbeddings(
  items: WeightedEmbeddingItem[],
  k: number,
  trace?: ClusterAttempt[]
): ClusterCentroid[] {
  if (items.length === 0) return []

  const targetK = Math.max(1, Math.min(k, MAX_K))

  if (targetK <= 1 || items.length < targetK) {
    return buildSingleCluster(items)
  }

  // The result to fall back to if this K isn't justified. Computed first so
  // each K is judged against the best result one cluster smaller, rather than
  // against the single centroid -- distance falls monotonically as K grows,
  // so a K-vs-1 comparison would always favor the largest K.
  const fallback = clusterTasteEmbeddings(items, targetK - 1, trace)

  const unitItems: UnitItem[] = items.map((item) => ({
    id: item.id,
    weight: item.weight,
    unit: l2Normalize(item.embedding),
  }))

  const result = runSphericalKMeans(unitItems, targetK)
  if (!result) {
    trace?.push({
      k: targetK,
      previousDistance: 0,
      splitDistance: 0,
      reduction: 0,
      smallestCluster: 0,
      kept: false,
      rejectedFor: 'kmeans-failed',
    })
    return fallback
  }

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)
  const rawClusters: Array<{ embedding: number[]; weight: number; itemCount: number }> = []

  for (let c = 0; c < targetK; c++) {
    const memberIndices: number[] = []
    for (let i = 0; i < result.assignments.length; i++) {
      if (result.assignments[i] === c) memberIndices.push(i)
    }
    const clusterWeight = memberIndices.reduce((sum, i) => sum + items[i].weight, 0)
    rawClusters.push({
      embedding: l2Normalize(result.centroids[c]),
      // Engagement weights are always > 0 in practice (see
      // builder.ts calculateEngagementWeight, whose every factor is
      // positive), but fall back to an equal share rather than emitting 0 --
      // weights must stay positive and sum to 1, which the
      // user_taste_clusters CHECK constraint also enforces.
      weight: totalWeight > 0 ? clusterWeight / totalWeight : 1 / targetK,
      itemCount: memberIndices.length,
    })
  }

  const smallestCluster = Math.min(...rawClusters.map((c) => c.itemCount))

  // Only keep the extra centroid if it explains structure the K-1 result
  // missed. Without this, any item set gets carved into K pieces whether or
  // not it has K real facets -- fragmenting a coherent taste into arbitrary
  // sub-clusters that each retrieve a narrower, worse candidate pool than one
  // good centroid would.
  //
  // Computed before the hard-floor check purely so a rejected attempt still
  // reports how close it came. Two O(n x k) passes over at most
  // MAX_CLUSTERING_INPUT_ITEMS vectors, once per profile rebuild.
  const previousDistance = avgDistanceToNearestCentroid(
    items,
    fallback.map((c) => c.embedding)
  )
  const splitDistance = avgDistanceToNearestCentroid(
    items,
    rawClusters.map((c) => c.embedding)
  )
  const reduction = previousDistance > 0 ? (previousDistance - splitDistance) / previousDistance : 0

  const attempt: ClusterAttempt = {
    k: targetK,
    previousDistance,
    splitDistance,
    reduction,
    smallestCluster,
    kept: false,
  }

  if (smallestCluster < MIN_ITEMS_PER_CLUSTER_HARD_FLOOR) {
    trace?.push({ ...attempt, rejectedFor: 'cluster-too-small' })
    return fallback
  }

  if (reduction < MIN_MARGINAL_DISPERSION_REDUCTION) {
    trace?.push({ ...attempt, rejectedFor: 'insufficient-reduction' })
    return fallback
  }

  trace?.push({ ...attempt, kept: true })

  return rawClusters
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((c, index) => ({
      clusterIndex: index,
      embedding: c.embedding,
      weight: c.weight,
      itemCount: c.itemCount,
    }))
}
