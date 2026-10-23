/**
 * The unified quality rating: what the recommender's quality term scores on.
 *
 * It replaced `community_rating`, the media server's own number, which measured
 * as an IMDb copy of uncertain age (r = 0.995 against `imdb_rating`, running
 * about 0.1 point high on releases from the last two years, F-087). Measured on
 * the live library with `scripts/probe-rating-sources.sql` and
 * `scripts/probe-rating-aggregate.sql` before any of this was written (F-167):
 *
 *   movies  0.6 audience + 0.4 critics
 *           audience = the refreshed IMDb rating
 *           critics  = 0.6 Metacritic + 0.4 RT critic score
 *   series  audience only (RT and Metacritic cover about 1% of shows)
 *
 * Four rules.
 *
 * 1. Every source but IMDb is RANK-MAPPED onto IMDb's own distribution before
 *    it is mixed: a title at the 80th percentile of Metacritic counts as the
 *    IMDb rating at IMDb's 80th percentile. The sources are not one scale --
 *    RT is a share of positive reviews that piles up at 100, Metacritic a
 *    weighted critic mean, IMDb an audience mean -- so a mean of raw numbers
 *    hands the result to whichever spreads widest. Mapping keeps the answer on
 *    IMDb's 0-10 scale, which is what calculateRatingScore expects. Ties take
 *    the middle of their rank range, so every RT 100 maps to the middle of the
 *    100s rather than the top.
 *
 * 2. Weights re-normalise over what a title HAS. A missing source never counts
 *    as zero; a film no critic reviewed is its audience figure.
 *
 * 3. TMDb is a fallback only, used when a title has no IMDb or media-server
 *    rating. Blended in at a quarter it lifted YA and franchise films and pulled
 *    down older non-English titles with thin TMDb coverage, and it was nearly all
 *    of the movement on series, while adding little IMDb did not already say
 *    (r = 0.83, IMDb on 99.9% of films).
 *
 * 4. An RT score far from the title's Metacritic is dropped
 *    (RT_MC_MAX_DISAGREEMENT). OMDb sometimes hands back the score of another
 *    film with the same name -- Guillermo del Toro's Pinocchio was stored with
 *    the 27 of the 2022 remake, beside its own correct Metacritic 79 -- and at a
 *    0.4 critic share that moves picks. Metacritic is kept because it is the
 *    graded measure; RT alone, with no Metacritic to check it, is used as is.
 *
 * Pure: no database. The loader is qualityRatings.ts; pinned by
 * unifiedRating.test.ts.
 */

export type UnifiedRatingMediaType = 'movie' | 'series'

export interface UnifiedRatingInput {
  id: string
  /** IMDb rating, 0-10, as refresh-ratings keeps it. */
  imdb: number | null
  /** The media server's rating, 0-10. Used only when there is no IMDb rating. */
  community: number | null
  /** TMDb vote average, 0-10. Used only when there is neither of the above. */
  tmdb: number | null
  /** RT critic score (Tomatometer), 0-100. */
  rt: number | null
  /** Metacritic score, 0-100. */
  metacritic: number | null
}

export const UNIFIED_RATING_WEIGHTS = {
  audience: 0.6,
  critics: 0.4,
  metacritic: 0.6,
  rt: 0.4,
} as const

/** Points (0-100) beyond which an RT score is taken to belong to another film. */
export const RT_MC_MAX_DISAGREEMENT = 50

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

/** The weighted mean of whichever of the two is present; null when neither is. */
export function presentMean(a: number | null, weightA: number, b: number | null, weightB: number): number | null {
  if (a == null && b == null) return null
  if (a == null) return b
  if (b == null) return a
  const total = weightA + weightB
  return total > 0 ? (weightA * a + weightB * b) / total : null
}

/**
 * The RT score to use, or null when it is missing or disagrees with the
 * title's Metacritic by more than RT_MC_MAX_DISAGREEMENT.
 */
export function trustedRtScore(rt: number | null, metacritic: number | null): number | null {
  if (rt == null) return null
  if (metacritic != null && Math.abs(rt - metacritic) > RT_MC_MAX_DISAGREEMENT) return null
  return rt
}

/**
 * Midrank percentile of every value in `values`, in [0, 1]: the middle of the
 * rank range a value's ties occupy. A single value is 0.5.
 */
export function midrankPercentiles(values: number[]): Map<number, number> {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const out = new Map<number, number>()
  if (n === 0) return out
  if (n === 1) {
    out.set(sorted[0], 0.5)
    return out
  }
  let lo = 0
  while (lo < n) {
    let hi = lo
    while (hi + 1 < n && sorted[hi + 1] === sorted[lo]) hi++
    out.set(sorted[lo], (lo + hi) / 2 / (n - 1))
    lo = hi + 1
  }
  return out
}

/** The value at percentile `p` of an ascending array (nearest rank). */
export function valueAtPercentile(sortedAscending: number[], p: number): number | null {
  const n = sortedAscending.length
  if (n === 0) return null
  const clamped = Math.min(1, Math.max(0, p))
  return sortedAscending[Math.round(clamped * (n - 1))]
}

/**
 * A mapper from one source's values onto the reference distribution: the
 * reference value at the same midrank percentile.
 */
function rankMapper(sourceValues: number[], referenceSorted: number[]): (value: number | null) => number | null {
  const percentiles = midrankPercentiles(sourceValues)
  return (value) => {
    if (value == null) return null
    const p = percentiles.get(value)
    return p == null ? null : valueAtPercentile(referenceSorted, p)
  }
}

/**
 * The rating to score: the unified one, else the media server's own for a
 * title the map does not hold (added since it was read, or a failed read).
 */
export function scoringRating(
  qualityRatings: Map<string, number | null>,
  id: string,
  communityRating: number | null | undefined
): number | null {
  if (qualityRatings.has(id)) return qualityRatings.get(id) ?? null
  return communityRating ?? null
}

/**
 * The unified rating (0-10) of every title in a library of one media type, or
 * null for a title with no rating from any source. Percentiles are taken over
 * the rows given, so pass the whole table, not a candidate pool.
 */
export function computeUnifiedRatings(
  rows: UnifiedRatingInput[],
  mediaType: UnifiedRatingMediaType
): Map<string, number | null> {
  const clean = rows.map((row) => ({
    id: row.id,
    imdb: finite(row.imdb),
    community: finite(row.community),
    tmdb: finite(row.tmdb),
    metacritic: finite(row.metacritic),
    rt: trustedRtScore(finite(row.rt), finite(row.metacritic)),
  }))

  const reference = clean
    .map((row) => row.imdb)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)

  const mapTmdb = rankMapper(clean.flatMap((r) => (r.tmdb == null ? [] : [r.tmdb])), reference)
  const mapMetacritic = rankMapper(clean.flatMap((r) => (r.metacritic == null ? [] : [r.metacritic])), reference)
  const mapRt = rankMapper(clean.flatMap((r) => (r.rt == null ? [] : [r.rt])), reference)

  const out = new Map<string, number | null>()
  for (const row of clean) {
    const audience = row.imdb ?? row.community ?? mapTmdb(row.tmdb)
    const critics =
      mediaType === 'movie'
        ? presentMean(mapMetacritic(row.metacritic), UNIFIED_RATING_WEIGHTS.metacritic, mapRt(row.rt), UNIFIED_RATING_WEIGHTS.rt)
        : null
    out.set(row.id, presentMean(audience, UNIFIED_RATING_WEIGHTS.audience, critics, UNIFIED_RATING_WEIGHTS.critics))
  }
  return out
}
