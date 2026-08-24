/**
 * Scoring a ranked library against a graded answer key.
 *
 * Pure, and separated from the query layer for the usual reason: the arithmetic
 * is where a measurement quietly becomes wrong, and it should be testable
 * without a database.
 *
 * ## Read this before using any number out of here
 *
 * These are a **floor check, never a target**. Every metric below can only
 * reward "more of what they already engaged with", so novelty and diversity
 * will always score worse on them — correctly. Tune a knob to maximise NDCG and
 * you have built the recommender that shows you twelve more of the thing you
 * regret watching.
 *
 * The legitimate uses are narrow: catching a regression, and settling a
 * retrieval question where the alternative is arguing from screenshots. For
 * "is this list any good", a person reading the neighbour dump is the better
 * instrument, and it is in this same module for exactly that reason.
 */

import type { GradedItem } from './holdout.js'

/** Where a single held-out title landed, and how much it was worth. */
export interface RankedHit {
  itemId: string
  /** 1-based position in the ranked library. */
  rank: number
  relevance: number
}

export interface UserMetrics {
  userId: string
  testItems: number
  /** Titles the ranking covered, i.e. everything it could have placed. */
  poolSize: number
  /**
   * Median position as a fraction of the library, 1 = top.
   *
   * The headline, because it is defined for a single held-out title. Recall@20
   * over eight answers is nearly binary and tells you almost nothing; a
   * percentile gives one usable observation per answer, which is what a
   * sporadic viewer can actually supply.
   */
  medianPercentile: number
  /** NDCG over the graded relevances at each cutoff. */
  ndcg: Record<number, number>
  /** Share of the graded relevance mass that landed inside each cutoff. */
  recall: Record<number, number>
}

export const DEFAULT_CUTOFFS = [20, 100, 500] as const

/**
 * Position as a fraction of the pool, 1 for rank 1 and 0 for last.
 *
 * A single-item pool is 1 rather than a division by zero — degenerate, but the
 * honest direction, since the only item is also the best one.
 */
export function percentileRank(rank: number, poolSize: number): number {
  if (!Number.isFinite(rank) || !Number.isFinite(poolSize) || poolSize <= 1) return 1
  const clamped = Math.min(Math.max(rank, 1), poolSize)
  return (poolSize - clamped) / (poolSize - 1)
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Standard discounted cumulative gain: relevance, discounted by log2 of rank. */
export function dcg(relevancesInRankOrder: number[]): number {
  let total = 0
  for (let i = 0; i < relevancesInRankOrder.length; i++) {
    total += relevancesInRankOrder[i] / Math.log2(i + 2)
  }
  return total
}

/**
 * NDCG at a cutoff, against the best arrangement the answer key allows.
 *
 * The ideal is the graded relevances sorted descending and truncated at k, so a
 * viewer with more answers than the cutoff is not penalised for the ones that
 * could not possibly fit.
 */
export function ndcgAt(hits: RankedHit[], allRelevances: number[], k: number): number {
  const withinK = [...hits]
    .filter((hit) => hit.rank <= k)
    .sort((a, b) => a.rank - b.rank)
    .map((hit) => hit.relevance)

  const ideal = [...allRelevances].sort((a, b) => b - a).slice(0, k)
  const idealGain = dcg(ideal)
  if (idealGain <= 0) return 0

  return dcg(withinK) / idealGain
}

/**
 * Share of the total graded relevance that landed inside the cutoff.
 *
 * Relevance-weighted rather than a plain count, so a rewatch reaching the top
 * 20 counts for more than a half-watched title doing the same. A plain recall
 * would treat them alike, which is the whole thing this module is avoiding.
 */
export function weightedRecallAt(hits: RankedHit[], allRelevances: number[], k: number): number {
  const total = allRelevances.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return 0

  const found = hits
    .filter((hit) => hit.rank <= k)
    .reduce((sum, hit) => sum + hit.relevance, 0)

  return found / total
}

export function scoreUser(
  userId: string,
  test: GradedItem[],
  ranks: Map<string, number>,
  poolSize: number,
  cutoffs: readonly number[] = DEFAULT_CUTOFFS
): UserMetrics {
  const hits: RankedHit[] = []
  const percentiles: number[] = []

  for (const item of test) {
    const rank = ranks.get(item.itemId)
    if (rank === undefined) {
      // Not in the ranked pool at all — no embedding, excluded library, or
      // removed from the catalogue since. Counts as the worst possible
      // position rather than being dropped, because dropping it would let a
      // configuration score well by simply retrieving less.
      percentiles.push(0)
      continue
    }
    hits.push({ itemId: item.itemId, rank, relevance: item.relevance })
    percentiles.push(percentileRank(rank, poolSize))
  }

  const allRelevances = test.map((item) => item.relevance)
  const ndcg: Record<number, number> = {}
  const recall: Record<number, number> = {}
  for (const k of cutoffs) {
    ndcg[k] = ndcgAt(hits, allRelevances, k)
    recall[k] = weightedRecallAt(hits, allRelevances, k)
  }

  return {
    userId,
    testItems: test.length,
    poolSize,
    medianPercentile: median(percentiles),
    ndcg,
    recall,
  }
}

export interface AggregateMetrics {
  users: number
  testItems: number
  medianPercentile: number
  ndcg: Record<number, number>
  recall: Record<number, number>
}

/**
 * Average across viewers, one vote each.
 *
 * Macro, never micro. Pooling every held-out title into one bucket weights each
 * viewer by how much they watch, so the result describes heavy users and calls
 * itself an average — the same aggregate-over-users mistake that made a
 * similarity-by-decade trend appear on this instance that existed in no
 * individual viewer.
 *
 * Callers must still print the per-user rows. This number is a summary of them,
 * not a substitute for them.
 */
export function macroAverage(
  perUser: UserMetrics[],
  cutoffs: readonly number[] = DEFAULT_CUTOFFS
): AggregateMetrics {
  if (perUser.length === 0) {
    const empty: Record<number, number> = {}
    for (const k of cutoffs) empty[k] = 0
    return { users: 0, testItems: 0, medianPercentile: 0, ndcg: empty, recall: { ...empty } }
  }

  const mean = (pick: (m: UserMetrics) => number) =>
    perUser.reduce((sum, m) => sum + pick(m), 0) / perUser.length

  const ndcg: Record<number, number> = {}
  const recall: Record<number, number> = {}
  for (const k of cutoffs) {
    ndcg[k] = mean((m) => m.ndcg[k] ?? 0)
    recall[k] = mean((m) => m.recall[k] ?? 0)
  }

  return {
    users: perUser.length,
    testItems: perUser.reduce((sum, m) => sum + m.testItems, 0),
    medianPercentile: mean((m) => m.medianPercentile),
    ndcg,
    recall,
  }
}

/**
 * Buckets for reporting by how much history a viewer has.
 *
 * A change can help viewers with a thin profile and hurt viewers with a thick
 * one, and the aggregate — dominated by whoever has more history — would read
 * that as a loss. Mean-centring is plausibly exactly such a change, since it
 * does most for a weak, low-signal centroid.
 */
export const HISTORY_BUCKETS = [
  { label: '<100', max: 100 },
  { label: '100-500', max: 500 },
  { label: '500+', max: Infinity },
] as const

export function historyBucket(trainSize: number): string {
  for (const bucket of HISTORY_BUCKETS) {
    if (trainSize < bucket.max) return bucket.label
  }
  return HISTORY_BUCKETS[HISTORY_BUCKETS.length - 1].label
}
