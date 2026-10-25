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
 *    IMDb rating at the 80th percentile -- of the titles that carry BOTH
 *    (rankMapper says why: a source's titles are not the library). The
 *    sources are not one scale --
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
 *    graded measure. RT alone, with no Metacritic to check it, is used as is,
 *    deliberately: the only other check is IMDb, and against IMDb a mismatch
 *    and a genuine split look identical -- Pinocchio's wrong RT 27 against
 *    IMDb 7.6 is the same shape as The Life of David Gale's real RT 19 against
 *    IMDb 7.5, which is exactly the disagreement a critic share exists to
 *    carry. A guard there would remove the feature from the titles it is for.
 *
 * Pure: no database. qualityRatings.ts computes and stores it on each title;
 * storedQualityRating reads it back. Pinned by
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

/**
 * Points (0-100) beyond which an RT score is taken to belong to another film.
 *
 * Derived from the measured distribution, not from the one mismatch that
 * prompted it (F-167). Over the 6,858 films carrying both, RT runs 5.7 points
 * above Metacritic on average, with sd 25.8 against 17.1 and r = 0.884, so
 * RT - MC has an sd of about 13.3. A 50-point gap is 3.3 sd on the side RT
 * already leans (RT above) and 4.2 sd on the other; under a normal model that
 * is about three genuine films in the library, and real tails are fatter, so
 * `scripts/probe-rating-sources.sql` section 7 counts and lists them. The
 * failure is asymmetric toward dropping: a genuine RT lost leaves Metacritic
 * carrying the whole critic half, while a wrong one kept moves the title by
 * the full 0.4 critic share.
 */
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

/** The value at percentile `p` of an ascending array (nearest rank). */
export function valueAtPercentile(sortedAscending: number[], p: number): number | null {
  const n = sortedAscending.length
  if (n === 0) return null
  const clamped = Math.min(1, Math.max(0, p))
  return sortedAscending[Math.round(clamped * (n - 1))]
}

/**
 * Midrank percentile of `value` within an ascending array, in [0, 1]. A value
 * present takes the middle of its ties, so every RT 100 maps to the middle of
 * the 100s rather than the top; a value
 * absent sits half a rank below the first value above it. A single-value
 * array answers 0.5.
 */
export function percentileWithin(sortedAscending: number[], value: number): number | null {
  const n = sortedAscending.length
  if (n === 0) return null
  if (n === 1) return 0.5
  let less = 0
  let hi = n
  while (less < hi) {
    const mid = (less + hi) >> 1
    if (sortedAscending[mid] < value) less = mid + 1
    else hi = mid
  }
  let equal = 0
  while (less + equal < n && sortedAscending[less + equal] === value) equal++
  const rank = equal > 0 ? less + (equal - 1) / 2 : less - 0.5
  return Math.min(1, Math.max(0, rank / (n - 1)))
}

export interface RankPair {
  source: number
  imdb: number
}

/**
 * A mapper from one source onto IMDb, built from the titles that carry BOTH:
 * a source value reads the IMDb rating at the same percentile among those
 * titles. Built from the pairs and not from the whole library, because the
 * titles a source covers are not the library -- the films critics reviewed are
 * better known and better rated than the films they did not -- and mapping a
 * critic's median onto the library's median IMDb would mark down every film a
 * critic reviewed, against every film no critic did. With no pairs it maps
 * nothing.
 */
export function rankMapper(pairs: RankPair[]): (value: number | null) => number | null {
  const source = pairs.map((p) => p.source).sort((a, b) => a - b)
  const reference = pairs.map((p) => p.imdb).sort((a, b) => a - b)
  return (value) => {
    if (value == null) return null
    const p = percentileWithin(source, value)
    return p == null ? null : valueAtPercentile(reference, p)
  }
}

export type UnifiedRatingSource = 'imdb' | 'mediaServer' | 'tmdb' | 'metacritic' | 'rt'

export interface UnifiedRating {
  /** 0-10, or null when no source rates the title. */
  rating: number | null
  /**
   * What `rating` is made of, in the order the rule reads them: the audience
   * source it used, then the critic scores it kept. Empty when `rating` is
   * null. Decided by the same computation as the number, so a label built from
   * it can never name a score the number does not contain (a guarded RT, or a
   * TMDb with nothing to map against).
   */
  sources: UnifiedRatingSource[]
}

/**
 * The share of the blend each half carries, as whole percentages: what a page
 * says the mix is. Shipped as a decided value, never written into the bundle,
 * so a retune of UNIFIED_RATING_WEIGHTS reaches the explanation with it.
 */
export function unifiedRatingShares(): { audience: number; critics: number } {
  const total = UNIFIED_RATING_WEIGHTS.audience + UNIFIED_RATING_WEIGHTS.critics
  const audience = Math.round((UNIFIED_RATING_WEIGHTS.audience / total) * 100)
  return { audience, critics: 100 - audience }
}

/**
 * The unified rating of every title in a library of one media type. Percentiles
 * are taken over the rows given, so pass the whole table, not a candidate pool.
 */
export function computeUnifiedRatings(
  rows: UnifiedRatingInput[],
  mediaType: UnifiedRatingMediaType
): Map<string, UnifiedRating> {
  const clean = rows.map((row) => ({
    id: row.id,
    imdb: finite(row.imdb),
    community: finite(row.community),
    tmdb: finite(row.tmdb),
    metacritic: finite(row.metacritic),
    rt: trustedRtScore(finite(row.rt), finite(row.metacritic)),
  }))

  const pairsOf = (pick: (row: (typeof clean)[number]) => number | null): RankPair[] =>
    clean.flatMap((row) => {
      const source = pick(row)
      return source == null || row.imdb == null ? [] : [{ source, imdb: row.imdb }]
    })

  const mapTmdb = rankMapper(pairsOf((r) => r.tmdb))
  const mapMetacritic = rankMapper(pairsOf((r) => r.metacritic))
  const mapRt = rankMapper(pairsOf((r) => r.rt))

  const out = new Map<string, UnifiedRating>()
  for (const row of clean) {
    const sources: UnifiedRatingSource[] = []
    let audience: number | null = null
    if (row.imdb != null) {
      audience = row.imdb
      sources.push('imdb')
    } else if (row.community != null) {
      audience = row.community
      sources.push('mediaServer')
    } else {
      audience = mapTmdb(row.tmdb)
      if (audience != null) sources.push('tmdb')
    }

    let critics: number | null = null
    if (mediaType === 'movie') {
      const metacritic = mapMetacritic(row.metacritic)
      const rt = mapRt(row.rt)
      if (metacritic != null) sources.push('metacritic')
      if (rt != null) sources.push('rt')
      critics = presentMean(metacritic, UNIFIED_RATING_WEIGHTS.metacritic, rt, UNIFIED_RATING_WEIGHTS.rt)
    }

    const rating = presentMean(audience, UNIFIED_RATING_WEIGHTS.audience, critics, UNIFIED_RATING_WEIGHTS.critics)
    out.set(row.id, { rating, sources: rating == null ? [] : sources })
  }
  return out
}

const KNOWN_SOURCES = new Set<string>(['imdb', 'mediaServer', 'tmdb', 'metacritic', 'rt'])

/**
 * A title's unified rating as stored on its row (`quality_rating`,
 * `quality_rating_sources`, migration 0213). NULL sources means not computed
 * yet -- a title synced since the last refresh -- and answers the media
 * server's own rating, which is what every reader used before the unified one,
 * named as such. NUMERIC arrives from pg as text, so both numbers are read
 * through Number(). The one reader of those columns, for the scorers and the
 * title page alike, so the two can never disagree about a title.
 */
export function storedQualityRating(
  rating: number | string | null | undefined,
  sources: readonly string[] | null | undefined,
  communityRating: number | string | null | undefined
): UnifiedRating {
  if (sources == null) {
    const community = toNumber(communityRating)
    return { rating: community, sources: community == null ? [] : ['mediaServer'] }
  }
  const value = toNumber(rating)
  return {
    rating: value,
    sources: value == null ? [] : sources.filter((s): s is UnifiedRatingSource => KNOWN_SOURCES.has(s)),
  }
}

/** The rating to score, from the stored columns (storedQualityRating). */
export function scoringRating(
  rating: number | string | null | undefined,
  sources: readonly string[] | null | undefined,
  communityRating: number | string | null | undefined
): number | null {
  return storedQualityRating(rating, sources, communityRating).rating
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
