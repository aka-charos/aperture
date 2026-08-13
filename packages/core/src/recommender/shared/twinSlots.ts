/**
 * Taste-twin matching and reserved recommendation slots.
 *
 * A taste twin is another viewer whose watch history overlaps a user's far more
 * than chance, measured by rarity-weighted set overlap (recommender/
 * twinAffinity.ts). What they have watched and the user has not is a candidate
 * pool no content model can produce: it encodes taste that survived a human
 * applying it, including the kind that a plot-synopsis embedding encodes badly.
 *
 * Like custom interests, this signal cannot win on score. It is sparse -- most
 * candidates have no twin behind them at all -- and dropping a sparse term into
 * a dense normalised score either does nothing or distorts everything depending
 * on its weight. So twins earn a bounded few *reserved slots* instead, exactly
 * as interestSlots.ts does, and scoring is left completely alone.
 *
 * Everything here is pure -- no DB access -- so the threshold arithmetic and the
 * slot allocation can be unit-tested without a database.
 */

/** One candidate pair, before any acceptance threshold is applied. */
export interface TwinPair {
  recipientId: string
  donorId: string
  /** Rarity-weighted cosine of the two watch sets, 0-1. */
  affinity: number
  /** Titles both have watched. Carried for diagnostics and the insights panel. */
  sharedCount: number
}

/** One viewer whose taste overlaps a recipient's enough to borrow from. */
export interface TwinDonor {
  donorId: string
  affinity: number
  sharedCount: number
}

/** recipientId -> their qualifying donors, strongest first. */
export type TwinIndex = Map<string, TwinDonor[]>

/**
 * The shipped ceiling, now `recommendation_config.{movie,series}_twin_max_slots`
 * and admin-editable. Kept here only as the value used when a config read
 * fails.
 *
 * This briefly shipped alongside a TWIN_SLOT_SHARE of 0.2, which capped the
 * count at a fifth of the list *underneath* the configured ceiling -- so an
 * admin who set 4 against a 10-item list got 2 and had no way to see why. The
 * share is gone; the visible number is the one that governs.
 */
export const DEFAULT_TWIN_MAX_SLOTS = 4

/**
 * Turn raw pairs into a per-recipient index, keeping only pairs that stand out
 * against the population.
 *
 * The bar is `median + k x MAD` over *every* pair on the instance, never a
 * constant. Two reasons, both load-bearing:
 *
 * 1. Absolute affinity numbers are not interpretable on their own. Most of any
 *    viewer's watch mass sits on titles nobody else has touched, which caps the
 *    achievable cosine far below 1 -- on a real instance the strongest genuine
 *    pair scored 0.198 against a body of 0.03-0.09. "Two to six times the
 *    typical pair" is the meaningful statement; "above 0.2" is not.
 * 2. The population moves. Enabling viewers changes the user count, which
 *    changes every idf, which shifts the whole distribution. A stored threshold
 *    would silently start firing at the wrong point.
 *
 * Median and MAD rather than mean and standard deviation because the
 * distribution is right-skewed and outliers are precisely what is being looked
 * for: they must not drag the centre they are measured against. MAD is used
 * raw, without the usual 1.4826 normal-consistency factor, since treating this
 * as approximately Gaussian would be pretending.
 *
 * A degenerate spread (MAD 0, i.e. most pairs identical) collapses the bar to
 * the median, which would admit half the population. Guarded: with no positive
 * deviation there is no outlier to find, so nothing qualifies.
 */
export function buildTwinIndex(pairs: TwinPair[], k: number): TwinIndex {
  const index: TwinIndex = new Map()
  if (pairs.length === 0 || !Number.isFinite(k) || k <= 0) return index

  const threshold = deriveTwinThreshold(
    pairs.map((pair) => pair.affinity),
    k
  )
  if (threshold === null) return index

  for (const pair of pairs) {
    if (pair.affinity < threshold) continue
    const donors = index.get(pair.recipientId) ?? []
    donors.push({
      donorId: pair.donorId,
      affinity: pair.affinity,
      sharedCount: pair.sharedCount,
    })
    index.set(pair.recipientId, donors)
  }

  for (const donors of index.values()) {
    donors.sort((a, b) => b.affinity - a.affinity || (a.donorId < b.donorId ? -1 : 1))
  }

  return index
}

/**
 * `median + k x MAD` of a sample, or null when the sample cannot support an
 * outlier test (empty, or every value identical).
 */
export function deriveTwinThreshold(values: number[], k: number): number | null {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0 || !Number.isFinite(k) || k <= 0) return null

  const median = medianOf(finite)
  const deviation = medianOf(finite.map((value) => Math.abs(value - median)))

  // No spread means no outliers. Returning median + 0 here would admit every
  // pair at or above the middle of the distribution, which is the opposite of
  // what this function is for.
  if (deviation <= 0) return null

  return median + k * deviation
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * How many of the final picks to hand over to taste twins.
 *
 * Bounded by three things the admin can see: how many twins actually cleared
 * the bar, the configured ceiling, and what is left of the list. No twins --
 * the common case -- means zero slots and a pipeline that behaves exactly as it
 * did before.
 *
 * `remainingCount` is what is left *after* interest slots are reserved, so the
 * two features can never over-reserve between them even if a stored ceiling
 * predates the UI that keeps the two sliders in bounds.
 */
export function computeReservedTwinSlots(
  remainingCount: number,
  twinCount: number,
  maxSlots: number
): number {
  if (!Number.isFinite(remainingCount) || !Number.isFinite(twinCount)) return 0
  if (!Number.isFinite(maxSlots) || maxSlots <= 0) return 0
  if (remainingCount <= 0 || twinCount <= 0) return 0

  return Math.max(0, Math.min(twinCount, Math.floor(maxSlots), remainingCount))
}

/**
 * Choose which candidates fill the reserved slots.
 *
 * Round-robin over the recipient's twins strongest-first, each getting one slot
 * before any twin gets a second, so a single prolific donor cannot take the
 * whole allocation.
 *
 * Within one twin the filler is the highest-scoring candidate they have watched
 * and the recipient has not. Ranking by the pipeline's own finalScore rather
 * than by rarity is deliberate and was the correction that made this feature
 * work: rarity discriminates beautifully between *pairs*, because a shared
 * title necessarily has two or more viewers, but an unwatched candidate almost
 * always has exactly one -- 46 of 48 sampled on a real instance -- so every
 * candidate ties at ln(N/1) and the ordering degenerates to arbitrary. The twin
 * decides which titles are *eligible*; the pipeline decides which are good.
 *
 * Fully deterministic: ties on finalScore break to the lower candidate id.
 */
export function pickTwinSlotFillers<T extends { id: string; finalScore: number }>(
  alreadySelected: T[],
  scored: T[],
  twins: TwinDonor[],
  donorWatched: Map<string, Set<string>>,
  slots: number
): Array<{ candidate: T; twin: TwinDonor }> {
  if (slots <= 0 || twins.length === 0) return []

  const scoredById = new Map<string, T>()
  for (const candidate of scored) {
    if (!scoredById.has(candidate.id)) scoredById.set(candidate.id, candidate)
  }

  const taken = new Set(alreadySelected.map((candidate) => candidate.id))
  const fillers: Array<{ candidate: T; twin: TwinDonor }> = []

  while (fillers.length < slots) {
    let pickedThisRound = false

    for (const twin of twins) {
      if (fillers.length >= slots) break

      const watched = donorWatched.get(twin.donorId)
      if (!watched || watched.size === 0) continue

      let bestCandidate: T | null = null
      for (const itemId of watched) {
        if (taken.has(itemId)) continue

        const candidate = scoredById.get(itemId)
        if (!candidate) continue

        if (
          !bestCandidate ||
          candidate.finalScore > bestCandidate.finalScore ||
          (candidate.finalScore === bestCandidate.finalScore && candidate.id < bestCandidate.id)
        ) {
          bestCandidate = candidate
        }
      }

      if (bestCandidate) {
        fillers.push({ candidate: bestCandidate, twin })
        taken.add(bestCandidate.id)
        pickedThisRound = true
      }
    }

    // Every twin is exhausted; leave the remaining slots unused rather than
    // padding the list, matching how unfilled interest slots behave.
    if (!pickedThisRound) break
  }

  return fillers
}
