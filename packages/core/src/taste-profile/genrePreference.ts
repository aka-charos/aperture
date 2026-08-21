/**
 * Availability-adjusted genre preference.
 *
 * The question a genre weight is meant to answer is "does this viewer like this
 * genre", and the old formula answered a different one: it compared a genre's
 * engagement against the average across that viewer's other genres, with no
 * reference at all to what the collection actually holds. In a library that is
 * one-third comedy, comedy comes out looking beloved by sheer volume, and a
 * viewer who watches every one of the eleven film noirs on the shelf looks
 * indifferent to noir.
 *
 * Measured on a live instance against 1,561 films of one viewer's history: raw
 * volume made comedy one of their largest genres (96 comedy-crimes, 183
 * comedy-dramas), while their availability-adjusted selection rate for comedy
 * is 0.76 -- they choose it distinctly LESS often than the shelf offers it.
 * Their real preferences are crime 1.88, thriller 1.52, mystery 1.42, biography
 * 1.33, against family 0.39, music 0.48 and horror 0.54. That is a 2.5-fold
 * spread between what the old measure reported and what the viewer does.
 *
 * The ratio here is the standard one: the share of the viewer's watched titles
 * carrying the genre, over the share of the available titles carrying it. 1.0
 * means they take it exactly as often as it is offered.
 *
 * Split out as a pure module for the same reason as watchedExclusion.ts and
 * pending.ts -- the arithmetic is the part worth pinning, and it should be
 * testable without a database.
 */

/**
 * Ratios are multiplicative, so everything below works in log2 space: taking a
 * genre twice as often as offered and half as often are equal and opposite
 * deviations, which a linear scale would get wrong in both directions.
 */
const LOG_CLAMP = 2

/**
 * Half the width of the weight band the selection ratio may occupy, around a
 * neutral 1.0. Deliberately 0.3, giving [0.7, 1.3] -- the SAME total width as
 * the band the old engagement formula produced ([0.8, 1.4], asymmetric for no
 * stated reason), so this change corrects what is measured without quietly
 * increasing how hard genre preference pushes. Rebalancing it against the
 * rating and favourite adjustments is a separate decision with its own
 * evidence, and mixing the two would make neither checkable.
 */
const BAND_HALF_WIDTH = 0.3

/**
 * Shrinkage constant. A genre the viewer has watched `n` titles of moves
 * `n / (n + K)` of the way from neutral to its measured ratio, so two films do
 * not establish a preference while fifty very nearly do.
 *
 * This is doing two jobs at once, which is why it is applied to the ratio
 * rather than to either side of it: it damps a thin *history*, and it damps a
 * thin *library* section, where a handful of available titles makes the
 * denominator jumpy. Both failures look identical from here -- a confident
 * ratio computed from almost nothing.
 */
const SHRINK_K = 10

export interface GenreSelection {
  /** Titles carrying this genre in the viewer's history. */
  watched: number
  /** Titles carrying this genre among those available to them. */
  available: number
}

export interface LibraryGenreCounts {
  /** Genre (as stored, case preserved) to the number of available titles. */
  counts: Map<string, number>
  /** Available titles carrying at least one genre. The ratio's denominator. */
  total: number
}

/**
 * How much more often the viewer takes this genre than it is offered.
 *
 * Null when the comparison cannot be made -- no history, no library, or a genre
 * the library does not have. Null is not 1.0 on purpose: "we cannot tell" and
 * "they are indifferent" are different claims, and only the caller knows which
 * of the two is safe to act on.
 */
export function selectionRatio(
  selection: GenreSelection,
  watchedTotal: number,
  availableTotal: number
): number | null {
  const { watched, available } = selection
  if (!Number.isFinite(watched) || !Number.isFinite(available)) return null
  if (watchedTotal <= 0 || availableTotal <= 0) return null
  if (available <= 0) return null
  if (watched <= 0) return null

  const watchedShare = watched / watchedTotal
  const availableShare = available / availableTotal
  if (availableShare <= 0) return null

  return watchedShare / availableShare
}

/**
 * Map a selection ratio onto the weight scale genre affinity reads, where 1.0
 * is neutral and the stored column is clamped to [0, 2].
 *
 * A null ratio returns exactly 1.0 -- unmeasurable has to be indistinguishable
 * from indifferent by the time it reaches a score, or a genre nobody can
 * measure would be penalised for it.
 */
export function genreWeightFromSelection(ratio: number | null, sampleSize: number): number {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return 1.0

  const clamped = Math.max(-LOG_CLAMP, Math.min(LOG_CLAMP, Math.log2(ratio)))
  const shrunk = clamped * (sampleSize / (sampleSize + SHRINK_K))

  return 1 + (shrunk / LOG_CLAMP) * BAND_HALF_WIDTH
}

/** Exposed for tests and for anything that needs to describe the scale. */
export const GENRE_PREFERENCE_BOUNDS = {
  min: 1 - BAND_HALF_WIDTH,
  max: 1 + BAND_HALF_WIDTH,
  logClamp: LOG_CLAMP,
  shrinkK: SHRINK_K,
} as const
