/**
 * Taste twins: viewers whose watch histories overlap far more than chance, used
 * to reserve a few recommendation slots for titles a like-minded human actually
 * finished.
 *
 * Sits here rather than in either pipeline for the same reason
 * watchedExclusion.ts and genreFamiliarity.ts do -- both media types need it,
 * and the two have a long history of drifting apart on questions like this.
 *
 * ## Why behaviour and not embeddings
 *
 * The obvious implementation is cosine between two users' taste-profile
 * centroids, and it does not work here. Measured across all 153 pairs on a real
 * instance, those cosines span 0.898-0.993 -- the whole population inside a
 * tenth of the scale, with genuinely unrelated viewers sitting above 0.95. That
 * is not a defect in how profiles are built: a centroid is the L2-normalized
 * mean of up to MAX_CLUSTERING_INPUT_ITEMS item vectors that already occupy a
 * narrow cone (taste-profile/clustering.ts records item-to-own-centroid
 * distances of 0.238-0.254 for every single user), and averaging many vectors
 * from a cone pulls every mean toward the cone's axis. Compression is the
 * arithmetic working as specified. Subtracting the population centroid first
 * does open the range back up, but that is a separate signal and not this one.
 *
 * Rarity-weighted set overlap has no such problem, because it never touches the
 * embedding space:
 *
 *   idf(title) = ln(users_with_history / users_who_watched_it)
 *   affinity(a,b) = sum of idf(t)^2 over shared t, normalised by both magnitudes
 *
 * A title everyone has seen scores idf 0 and contributes literally nothing, so
 * blockbusters are suppressed structurally rather than by a tuned penalty --
 * which is the entire point, since the viewers this feature exists to serve are
 * the ones whose taste the popular-title signal already fails.
 *
 * ## Donors are not recipients
 *
 * Only an enabled user can *receive* recommendations, but anyone with watch
 * history is valid *evidence*. Keeping those two populations separate is
 * load-bearing rather than tidy: on the instance this was designed against, the
 * single strongest pair (333 shared titles, roughly twice the affinity of the
 * next real pair) has a donor with recommendations switched off, and collapsing
 * the two populations would delete that relationship outright.
 *
 * The same asymmetry applies to the idf denominator, which counts *every* user
 * with history. Rarity is better estimated with more observers, so narrowing it
 * to enabled users would throw away precision for nothing.
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { WATCH_HISTORY_TASTE_SQL } from './watchedExclusion.js'
import type { TwinPair } from './shared/twinSlots.js'

const logger = createChildLogger('recommender-twin-affinity')

/**
 * Titles a user must have watched before they may take part at all, as donor or
 * recipient.
 *
 * This is the anti-inflation guard, and it is deliberately a *history* floor
 * rather than only an overlap floor, because that is where the artifact
 * actually comes from: cosine over idf-weighted vectors is inflated when one
 * rare shared title dominates a tiny magnitude. Unfiltered, the second-highest
 * affinity on a real instance was a pair sharing exactly one film. 25 removes
 * those decisively while costing only viewers who have barely started.
 */
export const MIN_TWIN_HISTORY = 25

/**
 * Titles two users must share before the pair is considered.
 *
 * Kept permissive because MIN_TWIN_HISTORY already does the anti-artifact work.
 * Raising this to 20 was tried and rejected: it discards genuine pairs that
 * overlap on 15-17 rare titles, which is a strong signal, not a weak one.
 */
export const MIN_TWIN_SHARED = 10

/**
 * How many of a pair's shared titles to carry along for the insights panel.
 *
 * These are the *rarest* shared titles, not a sample of them, because rarity is
 * literally what the affinity score is made of: a title both users watched
 * contributes idf^2 to the numerator, so the highest-idf shared titles are the
 * ones that earned the pair its place above the bar. Showing anything else
 * would illustrate the relationship with evidence that did not cause it, which
 * is the exact failure this data exists to fix -- the panel previously
 * explained a borrowed pick with content-similar titles from the reader's own
 * history, which is computed after the fact and had no part in the decision.
 *
 * Six fits one poster row without scrolling and is well under the MIN_TWIN_SHARED
 * floor, so a qualifying pair always has enough to fill it.
 */
export const SHARED_TITLE_SAMPLE = 6

interface TwinRow {
  recipient: string
  donor: string
  shared: string
  shared_top: string[] | null
  affinity: string
}

/**
 * The taste set per media type.
 *
 * Movies are one row per title. Series are stored per *episode*, so the set is
 * distinct series ids -- and a show favorited on the media server itself
 * produces no watch_history rows at all (favoriting marks the Series item), so
 * user_watching_series has to be unioned in exactly as
 * getExpandedFavoritedSeriesIds does. Copying the movie query would silently
 * drop every flagged show.
 */
function tasteSetSql(mediaType: 'movie' | 'series'): string {
  if (mediaType === 'movie') {
    return `SELECT DISTINCT wh.user_id, wh.movie_id AS item_id
              FROM watch_history wh
             WHERE wh.media_type = 'movie'
               AND wh.movie_id IS NOT NULL
               AND ${WATCH_HISTORY_TASTE_SQL}`
  }

  return `SELECT DISTINCT wh.user_id, e.series_id AS item_id
            FROM watch_history wh
            JOIN episodes e ON e.id = wh.episode_id
           WHERE wh.media_type = 'episode'
             AND ${WATCH_HISTORY_TASTE_SQL}
           UNION
          SELECT uws.user_id, uws.series_id AS item_id
            FROM user_watching_series uws`
}

/**
 * Every candidate pair on the instance, unthresholded.
 *
 * Deliberately not per-user and deliberately not filtered here: the acceptance
 * bar is derived from the spread of *every* pair, so a per-user call would
 * recompute the identical matrix once per viewer, and applying the bar in SQL
 * would put the one piece of real arithmetic somewhere a unit test cannot reach.
 * buildTwinIndex (shared/twinSlots.ts) does the thresholding, mirroring how
 * getWatchedGenreCounts hands raw counts to buildGenreFamiliarity.
 *
 * Batch callers fetch this once and pass the index down; the single-user
 * regenerate path fetches its own, which costs one query. The result is a few
 * hundred rows even on a large instance -- pairs are bounded by the number of
 * users, not the size of the library.
 *
 * Fails soft to an empty list, which reads downstream as "nobody has a twin"
 * and leaves the pipeline byte-identical to one without this feature.
 */
export async function getTwinPairs(mediaType: 'movie' | 'series'): Promise<TwinPair[]> {
  const pairs: TwinPair[] = []
  const enabledColumn = mediaType === 'movie' ? 'movies_enabled' : 'series_enabled'

  try {
    const result = await query<TwinRow>(
      `WITH taste AS (
         ${tasteSetSql(mediaType)}
       ),
       sz AS (SELECT user_id, COUNT(*) AS n FROM taste GROUP BY user_id),
       n AS (SELECT COUNT(DISTINCT user_id)::numeric AS total FROM taste),
       pop AS (SELECT item_id, COUNT(DISTINCT user_id) AS viewers FROM taste GROUP BY item_id),
       w AS (
         SELECT t.user_id, t.item_id, ln(n.total / p.viewers) AS idf
           FROM taste t
           JOIN pop p USING (item_id)
           CROSS JOIN n
       ),
       norm AS (SELECT user_id, sqrt(SUM(idf * idf)) AS mag FROM w GROUP BY user_id),
       pairs AS (
         SELECT r.user_id AS recipient,
                d.user_id AS donor,
                COUNT(*) AS shared,
                -- The rarest shared titles, which are the ones carrying the
                -- affinity. idf is a property of the item, so r.idf = d.idf
                -- here and ordering by either is ordering by rarity.
                (array_agg(r.item_id ORDER BY r.idf DESC))[1:$3::int] AS shared_top,
                SUM(r.idf * d.idf) / NULLIF(nr.mag * nd.mag, 0) AS affinity
           FROM w r
           JOIN w d ON d.item_id = r.item_id AND d.user_id <> r.user_id
           JOIN users rg ON rg.id = r.user_id
                        AND rg.is_enabled = true
                        AND rg.${enabledColumn} = true
                        AND rg.provider_disabled = false
           JOIN norm nr ON nr.user_id = r.user_id
           JOIN norm nd ON nd.user_id = d.user_id
           JOIN sz sr ON sr.user_id = r.user_id AND sr.n >= $1
           JOIN sz sd ON sd.user_id = d.user_id AND sd.n >= $1
          GROUP BY r.user_id, d.user_id, nr.mag, nd.mag
         HAVING COUNT(*) >= $2
       )
       SELECT recipient, donor, shared, shared_top, affinity
         FROM pairs
        WHERE affinity IS NOT NULL
        ORDER BY recipient, affinity DESC`,
      [MIN_TWIN_HISTORY, MIN_TWIN_SHARED, SHARED_TITLE_SAMPLE]
    )

    for (const row of result.rows) {
      const affinity = parseFloat(row.affinity)
      const sharedCount = parseInt(row.shared, 10)
      if (!Number.isFinite(affinity) || !Number.isFinite(sharedCount)) continue

      pairs.push({
        recipientId: row.recipient,
        donorId: row.donor,
        affinity,
        sharedCount,
        sharedTopIds: row.shared_top ?? [],
      })
    }

    logger.debug({ mediaType, pairs: pairs.length }, 'Loaded candidate taste-twin pairs')
  } catch (err) {
    logger.warn(
      { err, mediaType },
      'Failed to load taste twin pairs, recommendations will run without twin slots'
    )
  }

  return pairs
}

/**
 * Every item one donor has watched, as candidate material for a recipient.
 *
 * Returns raw ids only. Deliberately no ranking here: the diagnostic that drove
 * this design found that idf is degenerate for ordering *candidates* even
 * though it discriminates well between *pairs*. Shared titles necessarily have
 * two or more viewers so their idf varies, but an unwatched candidate almost
 * always has exactly one viewer -- 46 of 48 sampled -- so its idf is pinned at
 * ln(N/1) and every candidate ties. Ordering is left to the caller, which has
 * the pipeline's own finalScore and can actually tell these apart.
 */
export async function getDonorWatchedIds(
  donorIds: string[],
  mediaType: 'movie' | 'series'
): Promise<Map<string, Set<string>>> {
  const byDonor = new Map<string, Set<string>>()
  if (donorIds.length === 0) return byDonor

  try {
    const result = await query<{ user_id: string; item_id: string }>(
      `WITH taste AS (
         ${tasteSetSql(mediaType)}
       )
       SELECT user_id, item_id FROM taste WHERE user_id = ANY($1::uuid[])`,
      [donorIds]
    )

    for (const row of result.rows) {
      const set = byDonor.get(row.user_id) ?? new Set<string>()
      set.add(row.item_id)
      byDonor.set(row.user_id, set)
    }
  } catch (err) {
    logger.warn({ err, mediaType }, 'Failed to load donor watch sets, twin slots will go unfilled')
  }

  return byDonor
}
