/**
 * Discovery Blend Diagnostics
 *
 * What the four scoring weights CLAIM, against what they actually do.
 *
 * The admin panel presents `similarityWeight`, `popularityWeight` and
 * `recencyWeight` as shares of the blend. They are not, for two separate
 * reasons, and both were measured rather than argued:
 *
 * 1. THE CARD DIVIDED BY THREE. `scoreCandidates` divides by a total that also
 *    includes the fixed source term, so the shipped defaults are
 *    45.5/27.3/18.2/9.1 and the card reported 50/30/20. A fourth claimant
 *    nobody could see was still spending the budget.
 *
 * 2. INFLUENCE IS WEIGHT SHARE TIMES REALISED SPREAD (F-058). Only two of the
 *    four terms are normalised across the pool. Measured live across twenty
 *    runs, recency realised 24.5-33.2% against a configured 18.2%, and
 *    popularity 17.7-25.1% against 27.3% -- over-delivering and
 *    under-delivering respectively, in EVERY run without exception.
 *
 * Correcting the blend for (2) was simulated on this instance and rejected: it
 * bought no personalization (similarity was already on its configured share)
 * and only traded new-and-obscure for old-and-popular at constant taste, which
 * is an operator's preference rather than a defect. So the answer here is to
 * report the discrepancy rather than silently repair it -- the same call
 * F-054 made when the recommender's weight badge asserted a rule the
 * arithmetic did not impose.
 *
 * The shares are pure functions so they can be pinned without a database, and
 * the API sends DECIDED percentages rather than spreads, because the web bundle
 * never imports core and would otherwise need its own copy of the blend.
 */

import { createChildLogger } from '../lib/logger.js'
import { query } from '../lib/db.js'
import { SOURCE_TERM_WEIGHT } from './scorer.js'
import type { DiscoveryConfig, MediaType } from './types.js'

const logger = createChildLogger('discover:blend')

/** The four blend terms, in the order the panel lists them. */
export interface BlendTerms<T> {
  similarity: T
  popularity: T
  recency: T
  source: T
}

/** Standard deviation of each term over the candidates that competed. */
export type TermSpreads = BlendTerms<number>

export interface BlendDiagnostics {
  mediaType: MediaType
  /** How many runs the measurement is drawn from, one per viewer. */
  runs: number
  candidates: number
  /** Percentages, 0-100. */
  configured: BlendTerms<number>
  /** Percentages, 0-100. Null when nothing has been scored yet. */
  realised: BlendTerms<number> | null
}

/**
 * What the weights say, as percentages that sum to 100.
 *
 * Includes the source term, which is the whole point: leaving it out is what
 * made the card claim 50/30/20 for a 45.5/27.3/18.2/9.1 blend.
 */
export function configuredBlendShares(config: DiscoveryConfig): BlendTerms<number> {
  const w = {
    similarity: Math.max(0, config.similarityWeight),
    popularity: Math.max(0, config.popularityWeight),
    recency: Math.max(0, config.recencyWeight),
    source: SOURCE_TERM_WEIGHT,
  }
  const total = w.similarity + w.popularity + w.recency + w.source

  // Mirrors the scorer's own guard, which is `totalWeight <= 0` over a total
  // that INCLUDES the source term -- so this is unreachable while that term is
  // positive, and with all three sliders at zero the honest answer is that the
  // source score decides everything. Kept for parity: if the source term ever
  // became zero, both sides would fall back to the same unweighted mean.
  if (total <= 0) return { similarity: 25, popularity: 25, recency: 25, source: 25 }

  return {
    similarity: (w.similarity / total) * 100,
    popularity: (w.popularity / total) * 100,
    recency: (w.recency / total) * 100,
    source: (w.source / total) * 100,
  }
}

/**
 * What the weights actually do, as percentages that sum to 100.
 *
 * `weight x spread`, normalised -- the share of the final score's variation
 * each term accounts for. This is F-058's argument with standard deviation in
 * place of max-minus-min, because a spread is set by a single outlier while an
 * sd is set by the population; the conclusion is the same either way on the
 * measured data, and the sharper instrument is the one worth shipping.
 *
 * Covariance between terms is ignored. Measured on this instance the
 * recency/popularity correlation is +0.031 for movies and -0.191 for series,
 * so the terms do not meaningfully double-count -- but a future source mix
 * could change that, and then these numbers would overstate.
 *
 * Returns null when nothing has any spread, which is "not measurable" rather
 * than "all equal".
 */
export function realisedBlendShares(
  spreads: TermSpreads,
  config: DiscoveryConfig
): BlendTerms<number> | null {
  const contribution = {
    similarity: Math.max(0, config.similarityWeight) * Math.max(0, spreads.similarity),
    popularity: Math.max(0, config.popularityWeight) * Math.max(0, spreads.popularity),
    recency: Math.max(0, config.recencyWeight) * Math.max(0, spreads.recency),
    source: SOURCE_TERM_WEIGHT * Math.max(0, spreads.source),
  }
  const total =
    contribution.similarity + contribution.popularity + contribution.recency + contribution.source

  if (!Number.isFinite(total) || total <= 0) return null

  return {
    similarity: (contribution.similarity / total) * 100,
    popularity: (contribution.popularity / total) * 100,
    recency: (contribution.recency / total) * 100,
    source: (contribution.source / total) * 100,
  }
}

/**
 * Measure the spreads from the newest stored run per viewer.
 *
 * Per run, then averaged -- never pooled. Spread is a property of one viewer's
 * candidate pool, and a figure computed across viewers can show a shape present
 * in none of them (the repo-wide per-user invariant). Averaging the per-run
 * sds is the honest summary; the per-run numbers are what a real investigation
 * should read, and `scripts/probe-discovery-weights.sql` prints those.
 *
 * Reads `score_breakdown` rather than the top-level NUMERIC(6,4) columns, which
 * hold the same values rounded to four places.
 */
export async function getDiscoveryBlendDiagnostics(
  config: DiscoveryConfig
): Promise<BlendDiagnostics[]> {
  const configured = configuredBlendShares(config)

  try {
    const result = await query<{
      media_type: MediaType
      runs: string
      candidates: string
      sd_similarity: string | null
      sd_popularity: string | null
      sd_recency: string | null
      sd_source: string | null
    }>(
      // `->> IS NOT NULL` rather than the jsonb `?` operator: same test, and it
      // cannot be mistaken for a bind placeholder by anything downstream.
      `WITH latest AS (
         SELECT DISTINCT ON (user_id, media_type) run_id
           FROM discovery_candidates
          ORDER BY user_id, media_type, created_at DESC
       ),
       per_run AS (
         SELECT dc.media_type,
                dc.run_id,
                count(*) AS n,
                stddev_pop((dc.score_breakdown->>'similarity')::numeric) AS sd_similarity,
                stddev_pop((dc.score_breakdown->>'popularity')::numeric) AS sd_popularity,
                stddev_pop((dc.score_breakdown->>'recency')::numeric)    AS sd_recency,
                stddev_pop((dc.score_breakdown->>'source')::numeric)     AS sd_source
           FROM discovery_candidates dc
           JOIN latest l ON l.run_id = dc.run_id
          WHERE dc.score_breakdown->>'similarity' IS NOT NULL
            AND dc.score_breakdown->>'popularity' IS NOT NULL
            AND dc.score_breakdown->>'recency'    IS NOT NULL
            AND dc.score_breakdown->>'source'     IS NOT NULL
          GROUP BY dc.media_type, dc.run_id
       )
       SELECT media_type,
              count(*)::text  AS runs,
              sum(n)::text    AS candidates,
              avg(sd_similarity)::text AS sd_similarity,
              avg(sd_popularity)::text AS sd_popularity,
              avg(sd_recency)::text    AS sd_recency,
              avg(sd_source)::text     AS sd_source
         FROM per_run
        GROUP BY media_type`
    )

    const byMediaType = new Map<MediaType, BlendDiagnostics>()
    for (const row of result.rows) {
      // NUMERIC arrives as text and Number(null) is 0, not NaN -- so an absent
      // sd must map to undefined and be caught by the finite check, never
      // coerced into a real zero that would read as "this term does nothing".
      const spreads: TermSpreads = {
        similarity: row.sd_similarity == null ? NaN : Number(row.sd_similarity),
        popularity: row.sd_popularity == null ? NaN : Number(row.sd_popularity),
        recency: row.sd_recency == null ? NaN : Number(row.sd_recency),
        source: row.sd_source == null ? NaN : Number(row.sd_source),
      }
      const measurable = Object.values(spreads).every((v) => Number.isFinite(v))

      byMediaType.set(row.media_type, {
        mediaType: row.media_type,
        runs: Number(row.runs),
        candidates: Number(row.candidates),
        configured,
        realised: measurable ? realisedBlendShares(spreads, config) : null,
      })
    }

    // Both media types always appear, so a panel does not have to decide
    // whether a missing row means "no runs yet" or "the query failed".
    return (['movie', 'series'] as MediaType[]).map(
      (mediaType) =>
        byMediaType.get(mediaType) ?? {
          mediaType,
          runs: 0,
          candidates: 0,
          configured,
          realised: null,
        }
    )
  } catch (err) {
    logger.warn({ err }, 'Could not measure the discovery blend')
    return (['movie', 'series'] as MediaType[]).map((mediaType) => ({
      mediaType,
      runs: 0,
      candidates: 0,
      configured,
      realised: null,
    }))
  }
}
