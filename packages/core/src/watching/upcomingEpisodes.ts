/**
 * Upcoming Episode Data Fetcher
 * 
 * Fetches upcoming episode information for series, using:
 * 1. Emby episodes table (premiere_date for future episodes)
 * 2. TMDB API fallback (next_episode_to_air)
 */

import { createChildLogger } from '../lib/logger.js'
import { query, queryOne } from '../lib/db.js'
import { tmdbRequest } from '../tmdb/client.js'
import { pickLatestAired, type AiredEpisode } from './episodeWindows.js'

const logger = createChildLogger('upcoming-episodes')

export interface UpcomingEpisode {
  seriesId: string
  seasonNumber: number
  episodeNumber: number
  title: string
  overview: string | null
  airDate: string // ISO date string
  source: 'emby' | 'tmdb'
}

interface TMDbNextEpisode {
  id: number
  name: string
  overview: string | null
  air_date: string | null
  season_number: number
  episode_number: number
}

export interface TMDbSeasonSummary {
  season_number: number
  episode_count: number
  air_date: string | null
}

interface TMDbTVDetailsWithNextEpisode {
  id: number
  name: string
  next_episode_to_air: TMDbNextEpisode | null
  last_episode_to_air: TMDbNextEpisode | null
  number_of_episodes: number | null
  number_of_seasons: number | null
  seasons?: TMDbSeasonSummary[] | null
  status?: string | null
}

/**
 * Persist TMDB aired totals + per-season breakdown onto the series row. The
 * /tv/{id} response is already in hand when we look up upcoming episodes, so
 * caching here costs one UPDATE and keeps the watching page's "N aired" and
 * missing-season info fresh.
 */
export async function persistTmdbTotals(
  seriesId: string,
  tmdbData:
    | (Pick<
        TMDbTVDetailsWithNextEpisode,
        'number_of_episodes' | 'number_of_seasons' | 'seasons' | 'status'
      > & { last_episode_to_air?: TMDbNextEpisode | null })
    | null
): Promise<void> {
  try {
    if (tmdbData && typeof tmdbData.number_of_episodes === 'number' && tmdbData.number_of_episodes > 0) {
      const seasons = Array.isArray(tmdbData.seasons)
        ? tmdbData.seasons.map((s) => ({
            season_number: s.season_number,
            episode_count: s.episode_count,
            air_date: s.air_date ?? null,
          }))
        : null
      // '{}' rather than NULL when TMDb lists no aired episode: NULL means
      // "never asked" and sends the row back to the totals refresh.
      const last = tmdbData.last_episode_to_air
      const lastEpisode =
        last && last.air_date
          ? {
              season_number: last.season_number,
              episode_number: last.episode_number,
              name: last.name,
              air_date: last.air_date,
            }
          : {}
      await query(
        `UPDATE series
         SET tmdb_total_episodes = $2, tmdb_total_seasons = $3, tmdb_seasons = $4,
             tmdb_status = $5, tmdb_last_episode = $6, tmdb_totals_synced_at = NOW()
         WHERE id = $1`,
        [
          seriesId,
          tmdbData.number_of_episodes,
          tmdbData.number_of_seasons,
          seasons ? JSON.stringify(seasons) : null,
          tmdbData.status ?? null,
          JSON.stringify(lastEpisode),
        ]
      )
    } else {
      // Stamp the sync time even without usable totals so dead/renamed TMDB
      // ids aren't re-fetched on every request.
      await query(`UPDATE series SET tmdb_totals_synced_at = NOW() WHERE id = $1`, [seriesId])
    }
  } catch (err) {
    logger.debug({ err, seriesId }, 'Failed to persist TMDB totals')
  }
}

/**
 * Get upcoming episode for a single series
 * First checks Emby data, falls back to TMDB
 */
export async function getUpcomingEpisodeForSeries(
  seriesId: string,
  tmdbId: string | null
): Promise<UpcomingEpisode | null> {
  const today = new Date().toISOString().split('T')[0]

  // First, try to get from Emby episodes table
  const embyEpisode = await queryOne<{
    season_number: number
    episode_number: number
    title: string
    overview: string | null
    premiere_date: string
  }>(
    `SELECT season_number, episode_number, title, overview, premiere_date
     FROM episodes
     WHERE series_id = $1 
       AND premiere_date >= $2
     ORDER BY premiere_date ASC, season_number ASC, episode_number ASC
     LIMIT 1`,
    [seriesId, today]
  )

  if (embyEpisode && embyEpisode.premiere_date) {
    return {
      seriesId,
      seasonNumber: embyEpisode.season_number,
      episodeNumber: embyEpisode.episode_number,
      title: embyEpisode.title,
      overview: embyEpisode.overview,
      airDate: embyEpisode.premiere_date,
      source: 'emby',
    }
  }

  // Fallback to TMDB if we have a tmdb_id
  if (tmdbId) {
    try {
      const tmdbData = await tmdbRequest<TMDbTVDetailsWithNextEpisode>(`/tv/${tmdbId}`)

      await persistTmdbTotals(seriesId, tmdbData ?? null)

      if (tmdbData?.next_episode_to_air && tmdbData.next_episode_to_air.air_date) {
        return {
          seriesId,
          seasonNumber: tmdbData.next_episode_to_air.season_number,
          episodeNumber: tmdbData.next_episode_to_air.episode_number,
          title: tmdbData.next_episode_to_air.name,
          overview: tmdbData.next_episode_to_air.overview,
          airDate: tmdbData.next_episode_to_air.air_date,
          source: 'tmdb',
        }
      }
    } catch (err) {
      logger.debug({ err, tmdbId, seriesId }, 'Failed to fetch TMDB data for upcoming episode')
    }
  }

  return null
}

/**
 * Get upcoming episodes for multiple series
 * Returns a map of seriesId -> UpcomingEpisode
 *
 * options.tmdbFallbackIds bounds the live TMDB fallback: only series in the
 * set are fetched from TMDB when the episodes table has no future episode.
 * The batch Emby query always covers every id (single cheap query).
 */
export async function getUpcomingEpisodes(
  seriesIds: string[],
  options?: { tmdbFallbackIds?: Set<string> }
): Promise<Map<string, UpcomingEpisode>> {
  const result = new Map<string, UpcomingEpisode>()
  
  if (seriesIds.length === 0) {
    return result
  }

  const today = new Date().toISOString().split('T')[0]

  // Batch query for Emby episodes
  const embyEpisodes = await query<{
    series_id: string
    season_number: number
    episode_number: number
    title: string
    overview: string | null
    premiere_date: string
  }>(
    `SELECT DISTINCT ON (series_id) 
            series_id, season_number, episode_number, title, overview, premiere_date
     FROM episodes
     WHERE series_id = ANY($1)
       AND premiere_date >= $2
     ORDER BY series_id, premiere_date ASC, season_number ASC, episode_number ASC`,
    [seriesIds, today]
  )

  // Add Emby results to map
  for (const ep of embyEpisodes.rows) {
    result.set(ep.series_id, {
      seriesId: ep.series_id,
      seasonNumber: ep.season_number,
      episodeNumber: ep.episode_number,
      title: ep.title,
      overview: ep.overview,
      airDate: ep.premiere_date,
      source: 'emby',
    })
  }

  // Find series without Emby data that have TMDB IDs
  const seriesNeedingTmdb = seriesIds.filter(
    (id) => !result.has(id) && (!options?.tmdbFallbackIds || options.tmdbFallbackIds.has(id))
  )

  if (seriesNeedingTmdb.length > 0) {
    // Get TMDB IDs for these series
    const tmdbIds = await query<{ id: string; tmdb_id: string }>(
      `SELECT id, tmdb_id FROM series
       WHERE id = ANY($1) AND tmdb_id IS NOT NULL`,
      [seriesNeedingTmdb]
    )

    // Fetch from TMDB (with rate limiting consideration)
    for (const row of tmdbIds.rows) {
      try {
        const tmdbData = await tmdbRequest<TMDbTVDetailsWithNextEpisode>(`/tv/${row.tmdb_id}`)

        await persistTmdbTotals(row.id, tmdbData ?? null)

        if (tmdbData?.next_episode_to_air && tmdbData.next_episode_to_air.air_date) {
          result.set(row.id, {
            seriesId: row.id,
            seasonNumber: tmdbData.next_episode_to_air.season_number,
            episodeNumber: tmdbData.next_episode_to_air.episode_number,
            title: tmdbData.next_episode_to_air.name,
            overview: tmdbData.next_episode_to_air.overview,
            airDate: tmdbData.next_episode_to_air.air_date,
            source: 'tmdb',
          })
        }
      } catch (err) {
        logger.debug({ err, tmdbId: row.tmdb_id, seriesId: row.id }, 'Failed to fetch TMDB data')
      }
    }
  }

  return result
}

/**
 * Latest aired episode per series: the later of the newest episode on the
 * media server dated on or before today, and TMDb's last_episode_to_air as
 * cached on the series row by the totals refresh. Specials (season 0) are left
 * out on both sides, since a Christmas special is not "a new season". One
 * query, no TMDb calls.
 */
export async function getLatestAiredEpisodes(
  seriesIds: string[],
  today: string
): Promise<Map<string, AiredEpisode>> {
  const result = new Map<string, AiredEpisode>()
  if (seriesIds.length === 0) return result

  const rows = await query<{
    series_id: string
    season_number: number | null
    episode_number: number | null
    title: string | null
    air_date: string | null
    tmdb_last_episode: {
      season_number?: number
      episode_number?: number
      name?: string
      air_date?: string
    } | null
  }>(
    // to_char, not the bare DATE: node-pg turns a DATE into a Date at the
    // server's local midnight, which reads as the day before on hosts east of UTC.
    `SELECT s.id AS series_id, e.season_number, e.episode_number, e.title,
            to_char(e.premiere_date, 'YYYY-MM-DD') AS air_date, s.tmdb_last_episode
     FROM series s
     LEFT JOIN LATERAL (
       SELECT season_number, episode_number, title, premiere_date
       FROM episodes
       WHERE series_id = s.id AND season_number >= 1
         AND premiere_date IS NOT NULL AND premiere_date <= $2
       ORDER BY premiere_date DESC, season_number DESC, episode_number DESC
       LIMIT 1
     ) e ON true
     WHERE s.id = ANY($1)`,
    [seriesIds, today]
  )

  for (const row of rows.rows) {
    const emby: AiredEpisode | null =
      row.air_date && row.season_number != null && row.episode_number != null
        ? {
            seasonNumber: row.season_number,
            episodeNumber: row.episode_number,
            title: row.title ?? '',
            airDate: row.air_date,
            source: 'emby',
          }
        : null
    const last = row.tmdb_last_episode
    const tmdb: AiredEpisode | null =
      last &&
      typeof last.air_date === 'string' &&
      last.air_date <= today &&
      typeof last.season_number === 'number' &&
      last.season_number >= 1 &&
      typeof last.episode_number === 'number'
        ? {
            seasonNumber: last.season_number,
            episodeNumber: last.episode_number,
            title: last.name ?? '',
            airDate: last.air_date,
            source: 'tmdb',
          }
        : null
    const latest = pickLatestAired(emby, tmdb)
    if (latest) result.set(row.series_id, latest)
  }

  return result
}

/**
 * Format upcoming episode for display
 */
export function formatUpcomingEpisode(episode: UpcomingEpisode): string {
  const date = new Date(episode.airDate)
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
  
  return `S${episode.seasonNumber}E${episode.episodeNumber} - ${episode.title} (${dateStr})`
}

