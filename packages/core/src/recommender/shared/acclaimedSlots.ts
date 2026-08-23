/**
 * Reserved slots for widely-acclaimed titles.
 *
 * The problem this exists for, measured on a live instance: *The Shawshank
 * Redemption* (rating 9.3) scored 0.640 similarity against *All Quiet on the
 * Western Front* (7.8) at 0.895. The rating term correctly favoured Shawshank
 * -- 0.930 against 0.760 -- and still lost, because at the default blend
 * similarity outvotes rating roughly 5:1. Solving for the weight that would
 * flip it gives `w_rating > 0.60`: rating would have to be more than half the
 * entire blend, applied to every pick, to rescue a handful. That is not a
 * slider adjustment, it is a different product.
 *
 * So acclaim earns a bounded few *reserved slots* instead, exactly as
 * interestSlots.ts and twinSlots.ts do, and scoring is left completely alone.
 * Same reasoning in both cases: a signal that cannot win on score should not be
 * forced into the score, because the weight that makes it win for the items you
 * want also distorts every item you don't.
 *
 * Everything here is pure -- no DB access -- so the gate and the allocation can
 * be unit-tested without a database.
 */

/**
 * Defaults for the gate, used when a config read fails. Both are
 * `recommendation_config.{movie,series}_acclaimed_min_rating` / `_min_votes`
 * and admin-editable, because "acclaimed" is a property of a library rather
 * than a universal constant -- an instance of obscure world cinema may hold
 * nothing at all above 8.3.
 */
export const DEFAULT_ACCLAIMED_MIN_RATING = 8.3
export const DEFAULT_ACCLAIMED_MIN_VOTES = 50000
export const DEFAULT_ACCLAIMED_MAX_SLOTS = 0

/**
 * Whether a title's reputation is both high and *verified*.
 *
 * The vote floor is the whole reason this gate can be trusted, and it is the
 * one place a vote count belongs. Measured across a 12,589-film library, vote
 * count must NOT enter the quality score -- thin-voted titles there average
 * 5.95 against a library mean of 6.52, so shrinking ratings toward the mean
 * would *promote* 2,294 obscure poorly-rated films. But the same number is
 * exactly right as an eligibility test: it is what separates a 9.3 earned
 * across two million viewers from a 9.3 earned across two hundred.
 *
 * This mirrors the idf lesson from twinAffinity.ts, where rarity discriminates
 * beautifully between pairs and not at all between titles: a measure can be
 * sound as a *gate* and worthless as a *score*.
 *
 * A missing vote count fails, deliberately. An unverifiable reputation is
 * precisely what this is here to exclude, and at 99.9% column coverage the
 * cost of being strict is a handful of titles.
 */
export function isAcclaimed(
  rating: number | null | undefined,
  voteCount: number | null | undefined,
  minRating: number,
  minVotes: number
): boolean {
  if (rating == null || !Number.isFinite(rating)) return false
  if (voteCount == null || !Number.isFinite(voteCount)) return false
  return rating >= minRating && voteCount >= minVotes
}

/**
 * How many of the final picks to hand to acclaimed titles.
 *
 * Bounded only by things an admin can see: how many eligible titles the pool
 * actually holds, the configured ceiling, and what is left of the list. There
 * is deliberately no hidden share multiplier underneath the ceiling -- that
 * mistake shipped once with interest and twin slots, where a `*_SLOT_SHARE` of
 * 0.2 silently turned a configured 4 into 2 and gave the admin no way to see
 * why.
 *
 * `remainingCount` is what survives after interest and twin slots, so the three
 * features can never over-reserve between them however they are configured.
 *
 * A ceiling of 0 disables the feature outright, which is the intended off
 * switch -- and it is the default, so an upgrade changes nobody's
 * recommendations until an admin asks for it.
 */
export function computeReservedAcclaimedSlots(
  remainingCount: number,
  eligibleCount: number,
  maxSlots: number
): number {
  if (!Number.isFinite(remainingCount) || !Number.isFinite(eligibleCount)) return 0
  if (!Number.isFinite(maxSlots) || maxSlots <= 0) return 0
  if (remainingCount <= 0 || eligibleCount <= 0) return 0

  return Math.max(0, Math.min(eligibleCount, Math.floor(maxSlots), remainingCount))
}

/**
 * Choose which candidates fill the reserved slots.
 *
 * Ordered by the pipeline's own `finalScore`, NOT by rating -- and that is the
 * difference between a feature and a "top 20 films of all time" strip. Sorting
 * the eligible set by rating hands every user on the instance the same titles
 * in the same order, which is the failure mode this whole investigation started
 * from. Sorting by finalScore gives each user the acclaimed films nearest their
 * own taste: the gate decides what is *eligible*, the ranking decides what is
 * *good for this viewer*. Same division as pickTwinSlotFillers.
 *
 * Fully deterministic: ties on finalScore break to the lower candidate id.
 */
export function pickAcclaimedSlotFillers<T extends { id: string; finalScore: number }>(
  alreadySelected: T[],
  eligible: T[],
  slots: number
): T[] {
  if (slots <= 0 || eligible.length === 0) return []

  const taken = new Set(alreadySelected.map((candidate) => candidate.id))
  const available = eligible.filter((candidate) => !taken.has(candidate.id))

  available.sort(
    (a, b) => b.finalScore - a.finalScore || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )

  return available.slice(0, slots)
}

/** What gets stored on a pick so the insights panel and the explanation prompt can read it back. */
export interface StoredAcclaimedPick {
  rating: number
  voteCount: number
}
