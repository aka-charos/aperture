/**
 * TMDB aired-totals refresh for series shown on the watching page.
 *
 * Totals are cached on the series row (tmdb_total_episodes/seasons) and
 * refreshed lazily: the API route calls refreshStaleTmdbTotals fire-and-forget
 * after responding, so a bounded number of stale series converge over a few
 * page visits without slowing the request or hammering TMDB.
 */

import { createChildLogger } from '../lib/logger.js'
import { query } from '../lib/db.js'
import { tmdbRequest } from '../tmdb/client.js'
import { persistTmdbTotals, type TMDbSeasonSummary } from './upcomingEpisodes.js'

const logger = createChildLogger('tmdb-totals')

interface TMDbTVTotals {
  id: number
  number_of_episodes: number | null
  number_of_seasons: number | null
  seasons?: TMDbSeasonSummary[] | null
}

const DEFAULT_TTL_HOURS = 24 * 7
const DEFAULT_MAX_FETCHES = 30

/**
 * Refresh TMDB aired totals for the given series where the cached value is
 * missing or older than the TTL. Fetch count is capped per call.
 */
export async function refreshStaleTmdbTotals(
  seriesIds: string[],
  opts: { ttlHours?: number; maxFetches?: number } = {}
): Promise<{ refreshed: number }> {
  const ttlHours = opts.ttlHours ?? DEFAULT_TTL_HOURS
  const maxFetches = opts.maxFetches ?? DEFAULT_MAX_FETCHES

  if (seriesIds.length === 0) {
    return { refreshed: 0 }
  }

  const stale = await query<{ id: string; tmdb_id: string }>(
    `SELECT id, tmdb_id FROM series
     WHERE id = ANY($1)
       AND tmdb_id IS NOT NULL
       AND (tmdb_totals_synced_at IS NULL OR tmdb_totals_synced_at < NOW() - ($2 || ' hours')::interval)
     ORDER BY tmdb_totals_synced_at ASC NULLS FIRST
     LIMIT $3`,
    [seriesIds, String(ttlHours), maxFetches]
  )

  let refreshed = 0
  for (const row of stale.rows) {
    try {
      const tmdbData = await tmdbRequest<TMDbTVTotals>(`/tv/${row.tmdb_id}`)
      await persistTmdbTotals(row.id, tmdbData ?? null)
      refreshed++
    } catch (err) {
      logger.debug({ err, seriesId: row.id, tmdbId: row.tmdb_id }, 'Failed to refresh TMDB totals')
      // Stamp anyway so a persistently failing id doesn't consume the
      // per-request budget every visit.
      await persistTmdbTotals(row.id, null)
    }
  }

  if (refreshed > 0) {
    logger.info({ refreshed, candidates: stale.rows.length }, 'Refreshed TMDB series totals')
  }

  return { refreshed }
}
