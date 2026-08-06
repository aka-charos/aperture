/**
 * Cluster Candidate Budget Allocation
 *
 * Pure math for splitting a total candidate-retrieval limit across a user's
 * K taste clusters (see taste-profile/clustering.ts), proportional to each
 * cluster's engagement-mass weight, with a floor so a minority-but-real taste
 * cluster is never starved down to near-zero candidates just because it
 * represents a smaller share of the user's watch history.
 */

/**
 * ~3x the existing top-100 custom-interest-rescoring precedent
 * (movies/pipeline.ts, series/pipeline.ts), comfortably above selectedCount
 * (~12-50). At K<=3 and the 50000 admin default for maxCandidates, the total
 * floor (<=1500) stays a small fraction of the overall budget.
 */
export const MIN_CANDIDATES_PER_CLUSTER = 500

/**
 * Reserves MIN_CANDIDATES_PER_CLUSTER for every cluster first, then
 * distributes the remaining budget proportionally by weight -- so the sum
 * stays close to totalLimit rather than ballooning by K x floor. Degrades to
 * an even split if totalLimit is too small to floor every cluster
 * (defensive; not expected at realistic maxCandidates values with K<=3).
 */
export function allocateClusterCandidateLimits(weights: number[], totalLimit: number): number[] {
  const k = weights.length
  if (k === 0) return []
  if (k === 1) return [totalLimit]

  const totalFloor = MIN_CANDIDATES_PER_CLUSTER * k
  if (totalFloor >= totalLimit) {
    return weights.map(() => Math.floor(totalLimit / k))
  }

  const weightSum = weights.reduce((sum, w) => sum + w, 0) || 1
  const remainder = totalLimit - totalFloor

  return weights.map((w) => MIN_CANDIDATES_PER_CLUSTER + Math.round((w / weightSum) * remainder))
}
