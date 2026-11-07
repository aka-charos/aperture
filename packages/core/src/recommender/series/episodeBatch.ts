import { createChildLogger } from '../../lib/logger.js'
import { query } from '../../lib/db.js'
import { listingIsComplete } from '../shared/listingComplete.js'
import { episodeKey, episodeRowParams, episodeRowsSource, planEpisodeBatch, widestPerNumber } from './episodeRows.js'
import type { PreparedEpisode } from './syncTypes.js'

const logger = createChildLogger('sync-series')

/** Array columns travel as JSONB; back to text[] here. */
const textArray = (column: string) => `COALESCE(ARRAY(SELECT jsonb_array_elements_text(${column})), '{}')`

/** Stamped only when the range really changes: `updated_at` moves on every sync. */
const rangeChangedAt = (stored: string, incoming: string) =>
  `CASE WHEN ${stored}.episode_number_end IS DISTINCT FROM ${incoming}.episode_number_end
        THEN NOW() ELSE ${stored}.episode_number_end_changed_at END`

/**
 * Write one batch. An episode the library holds under another media-server id is not
 * written here: it comes back in `rekeyed`, for `settleRekeyedEpisodes` once the
 * library's listing is complete.
 */
export async function processEpisodeBatch(
  episodes: PreparedEpisode[],
  existingProviderIds: Set<string>,
  existingEpisodeKeys: Set<string>
): Promise<{ added: number; updated: number; rekeyed: PreparedEpisode[] }> {
  const plan = planEpisodeBatch(episodes, existingProviderIds, existingEpisodeKeys)

  let added = 0
  // Further versions of an episode being inserted count as updates, as they always have
  let updated = plan.duplicates

  if (plan.update.length > 0) {
    try {
      const result = await query(
        `UPDATE episodes SET
          series_id = data.series_id,
          season_number = data.season_number,
          episode_number = data.episode_number,
          title = data.title,
          overview = data.overview,
          premiere_date = data.premiere_date,
          year = data.year,
          runtime_minutes = data.runtime_minutes,
          community_rating = data.community_rating,
          directors = ${textArray('data.directors')},
          writers = ${textArray('data.writers')},
          guest_stars = data.guest_stars,
          path = data.path,
          media_sources = data.media_sources,
          poster_url = data.poster_url,
          episode_number_end_changed_at = ${rangeChangedAt('episodes', 'data')},
          episode_number_end = data.episode_number_end,
          updated_at = NOW()
        FROM (SELECT * FROM ${episodeRowsSource('t')}) AS data
        WHERE episodes.provider_item_id = data.provider_item_id`,
        episodeRowParams(plan.update)
      )
      updated += result.rowCount || plan.update.length
    } catch (err) {
      logger.error({ err, count: plan.update.length }, 'Failed to bulk update episodes')
    }
  }

  // Uses RETURNING with xmax to distinguish true inserts (xmax=0) from updates (xmax>0)
  if (plan.insert.length > 0) {
    try {
      const result = await query<{ xmax: string }>(
        `INSERT INTO episodes (
          provider_item_id, series_id, season_number, episode_number, title,
          overview, premiere_date, year, runtime_minutes, community_rating,
          directors, writers, guest_stars, path, media_sources, poster_url,
          episode_number_end
        )
        SELECT
          t.provider_item_id, t.series_id, t.season_number, t.episode_number, t.title,
          t.overview, t.premiere_date, t.year, t.runtime_minutes, t.community_rating,
          ${textArray('t.directors')}, ${textArray('t.writers')},
          t.guest_stars, t.path, t.media_sources, t.poster_url,
          t.episode_number_end
        FROM ${episodeRowsSource('t')}
        ON CONFLICT (series_id, season_number, episode_number) DO UPDATE SET
          provider_item_id = EXCLUDED.provider_item_id,
          title = EXCLUDED.title,
          overview = EXCLUDED.overview,
          premiere_date = EXCLUDED.premiere_date,
          year = EXCLUDED.year,
          runtime_minutes = EXCLUDED.runtime_minutes,
          community_rating = EXCLUDED.community_rating,
          directors = EXCLUDED.directors,
          writers = EXCLUDED.writers,
          guest_stars = EXCLUDED.guest_stars,
          path = EXCLUDED.path,
          media_sources = EXCLUDED.media_sources,
          poster_url = EXCLUDED.poster_url,
          episode_number_end_changed_at = ${rangeChangedAt('episodes', 'EXCLUDED')},
          episode_number_end = EXCLUDED.episode_number_end,
          updated_at = NOW()
        RETURNING xmax`,
        episodeRowParams(plan.insert)
      )
      // xmax = 0 means true insert; PostgreSQL returns it as a string
      const trueInserts = result.rows.filter((r) => Number(r.xmax) === 0).length
      added = trueInserts
      updated += result.rows.length - trueInserts
      for (const pe of plan.insert) {
        existingProviderIds.add(pe.episode.id)
        existingEpisodeKeys.add(episodeKey(pe))
      }
    } catch (err) {
      logger.error({ err, count: plan.insert.length }, 'Failed to bulk insert episodes')
    }
  }

  return { added, updated, rekeyed: plan.rekeyed }
}

/**
 * Episodes listed under a new media-server id at a number the library already holds,
 * decided once the library's whole listing has been read.
 *
 * - The stored row's own id is no longer listed: the server re-keyed the item (a
 *   replaced file does this). The row moves onto the new id with the new facts, so it
 *   keeps its id and the watch history pointing at it. Updating by the old id would
 *   match nothing, and the cleanup would then delete the row and its history.
 * - The stored id is still listed: this is a second version of the episode. Only its
 *   range is taken, when it covers more numbers than the row does.
 *
 * An incomplete listing cannot tell a re-keyed item from one it skipped, so it only
 * widens; the cleanup is off for that library anyway.
 */
export async function settleRekeyedEpisodes(
  rekeyed: readonly PreparedEpisode[],
  listing: { expected: number; fetched: number; seen: ReadonlySet<string> }
): Promise<{ rebound: number; widened: number }> {
  if (rekeyed.length === 0) return { rebound: 0, widened: 0 }
  const chosen = widestPerNumber(rekeyed)
  const params = episodeRowParams(chosen)
  const complete = listingIsComplete({
    expected: listing.expected,
    fetched: listing.fetched,
    distinct: listing.seen.size,
  })

  let rebound = 0
  if (complete) {
    try {
      const result = await query(
        `UPDATE episodes e SET
          provider_item_id = t.provider_item_id,
          title = t.title,
          overview = t.overview,
          premiere_date = t.premiere_date,
          year = t.year,
          runtime_minutes = t.runtime_minutes,
          community_rating = t.community_rating,
          directors = ${textArray('t.directors')},
          writers = ${textArray('t.writers')},
          guest_stars = t.guest_stars,
          path = t.path,
          media_sources = t.media_sources,
          poster_url = t.poster_url,
          episode_number_end_changed_at = ${rangeChangedAt('e', 't')},
          episode_number_end = t.episode_number_end,
          updated_at = NOW()
        FROM (SELECT * FROM ${episodeRowsSource('r')}) AS t
        WHERE e.series_id = t.series_id
          AND e.season_number = t.season_number
          AND e.episode_number = t.episode_number
          AND NOT (e.provider_item_id = ANY($${params.length + 1}::text[]))
          AND NOT EXISTS (SELECT 1 FROM episodes taken WHERE taken.provider_item_id = t.provider_item_id)`,
        [...params, [...listing.seen]]
      )
      rebound = result.rowCount || 0
    } catch (err) {
      logger.error({ err, count: chosen.length }, 'Failed to move episodes onto their new media-server ids')
    }
  }

  let widened = 0
  try {
    const result = await query(
      `UPDATE episodes e SET
        episode_number_end = t.episode_number_end,
        episode_number_end_changed_at = NOW(),
        updated_at = NOW()
      FROM (SELECT * FROM ${episodeRowsSource('r')}) AS t
      WHERE e.series_id = t.series_id
        AND e.season_number = t.season_number
        AND e.episode_number = t.episode_number
        AND t.episode_number_end > COALESCE(e.episode_number_end, e.episode_number)`,
      params
    )
    widened = result.rowCount || 0
  } catch (err) {
    logger.error({ err, count: chosen.length }, 'Failed to widen episode ranges from second versions')
  }

  return { rebound, widened }
}
