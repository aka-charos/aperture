/**
 * Upcoming Episode Data Fetcher
 * 
 * Fetches upcoming episode information for series, using:
 * 1. Emby episodes table (premiere_date for future episodes)
 * 2. TMDB API fallback (next_episode_to_air)
 */

import { createChildLogger } from '../lib/logger.js'
import { query, queryOne } from '../lib/db.js'
import { AsyncCache, concurrencyLimit } from '../lib/asyncCache.js'
import { getTMDbApiKey } from '../settings/systemSettings.js'
import { tmdbLookup } from '../tmdb/client.js'
import { WATCH_HISTORY_PLAYED_SQL } from '../recommender/watchedExclusion.js'
import { pickLatestAired, type AiredEpisode, type SeasonProgress } from './episodeWindows.js'

const logger = createChildLogger('upcoming-episodes')

/** How long TMDb's answer about one show is reused, an absent next episode included. */
export const FORECAST_TTL_MS = 30 * 60_000
const FORECAST_MAX_ENTRIES = 2000
/** Across every viewer in this process, not per request. */
export const FORECAST_CONCURRENCY = 4
/** One attempt: a person is waiting, and a miss costs only this page load. */
export const FORECAST_TIMEOUT_MS = 5_000
/**
 * The longest a request waits for all its lookups. Without it a TMDb outage costs
 * (lookups / concurrency) x timeout. Lookups past it still finish and fill the
 * cache; their shows are simply without a TMDb episode for this one response.
 */
export const FORECAST_BATCH_BUDGET_MS = 15_000

export interface UpcomingEpisode {
  seriesId: string
  seasonNumber: number
  episodeNumber: number
  title: string
  overview: string | null
  airDate: string // ISO date string
  source: 'emby' | 'tmdb'
}

/**
 * Why a show came back with no upcoming episode. These are different answers and
 * a caller stating one to a person must not merge them: only `noneAnnounced` is
 * TMDb actually saying nothing is scheduled.
 */
export type UpcomingGap =
  /** TMDb answered: it knows the show and lists no dated next episode. */
  | 'noneAnnounced'
  /** No TMDb id on the row, or TMDb does not know that id. */
  | 'noTmdbEntry'
  /** No TMDb key configured, so TMDb could not be asked. */
  | 'noTmdbKey'
  /** TMDb was asked and did not answer: an error, a timeout, or past the time budget. */
  | 'lookupFailed'
  /** Left out by the caller's `tmdbFallbackIds`. */
  | 'notAsked'

export interface UpcomingEpisodesReport {
  episodes: Map<string, UpcomingEpisode>
  /** One entry for every requested show that is not in `episodes`. */
  gaps: Map<string, UpcomingGap>
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
export function persistTmdbTotals(seriesId: string, tmdbData: TmdbTotalsInput): Promise<void> {
  return writeTmdbTotals('id', seriesId, tmdbData)
}

type TmdbTotalsInput =
  | (Pick<
      TMDbTVDetailsWithNextEpisode,
      'number_of_episodes' | 'number_of_seasons' | 'seasons' | 'status'
    > & { last_episode_to_air?: TMDbNextEpisode | null })
  | null

/**
 * `tmdb_id` writes every row of a show: one TMDb answer is cached per TMDb id, so
 * a show held in two libraries gets both rows written the one time it arrives.
 */
async function writeTmdbTotals(
  column: 'id' | 'tmdb_id',
  value: string,
  tmdbData: TmdbTotalsInput
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
         WHERE ${column} = $1`,
        [
          value,
          tmdbData.number_of_episodes,
          tmdbData.number_of_seasons,
          seasons ? JSON.stringify(seasons) : null,
          tmdbData.status ?? null,
          JSON.stringify(lastEpisode),
        ]
      )
    } else {
      // Stamp the sync time even without usable totals so dead/renamed TMDB
      // ids aren't re-fetched on every request. A NULL tmdb_last_episode is
      // marked asked ('{}') for the same reason: the staleness check treats
      // NULL there as "never asked" whatever the stamp says, so a show whose
      // lookup started failing after it had totals would otherwise be fetched
      // on every load. A value already stored is kept.
      await query(
        `UPDATE series
         SET tmdb_totals_synced_at = NOW(),
             tmdb_last_episode = COALESCE(tmdb_last_episode, '{}'::jsonb)
         WHERE ${column} = $1`,
        [value]
      )
    }
  } catch (err) {
    logger.debug({ err, [column]: value }, 'Failed to persist TMDB totals')
  }
}

/** TMDb's answer about one show. Public data: it holds nothing about a viewer. */
interface Forecast {
  next: TMDbNextEpisode | null
  /** False when TMDb answered that it has no such show. */
  known: boolean
}

const forecasts = new AsyncCache<Forecast>({
  ttlMs: FORECAST_TTL_MS,
  maxEntries: FORECAST_MAX_ENTRIES,
})
const limitForecasts = concurrencyLimit(FORECAST_CONCURRENCY)

/**
 * What TMDb says comes next for a show; null when it could not be asked. Shared
 * by concurrent requests, and a null is not kept, so a failure is retried by the
 * next load rather than read as "no upcoming episode". The totals are written
 * only for a real answer, so a failure does not mark the row as freshly synced
 * either (`refreshStaleTmdbTotals` keeps its own rule for that).
 */
async function getForecast(tmdbId: string, apiKey: string): Promise<Forecast | null> {
  try {
    const forecast = await forecasts.get(tmdbId, () =>
      limitForecasts(async () => {
        const lookup = await tmdbLookup<TMDbTVDetailsWithNextEpisode>(`/tv/${tmdbId}`, {
          apiKey,
          timeoutMs: FORECAST_TIMEOUT_MS,
          maxAttempts: 1,
        })
        if (lookup.status === 'failed') return null
        const details = lookup.status === 'ok' ? lookup.data : null
        await writeTmdbTotals('tmdb_id', tmdbId, details)
        return { next: details?.next_episode_to_air ?? null, known: lookup.status === 'ok' }
      })
    )
    return forecast ?? null
  } catch (err) {
    logger.debug({ err, tmdbId }, 'Failed to fetch TMDB data for upcoming episode')
    return null
  }
}

function tmdbUpcomingEpisode(seriesId: string, next: TMDbNextEpisode): UpcomingEpisode {
  return {
    seriesId,
    seasonNumber: next.season_number,
    episodeNumber: next.episode_number,
    title: next.name,
    overview: next.overview,
    airDate: next.air_date as string,
    source: 'tmdb',
  }
}

/**
 * The forecasts for many shows, within a time budget. A show in neither map was
 * not answered: TMDb failed, or the budget ran out first.
 */
async function lookUpForecasts(
  rows: ReadonlyArray<{ id: string; tmdb_id: string }>,
  apiKey: string,
  budgetMs: number
): Promise<{
  found: Map<string, UpcomingEpisode>
  empty: Map<string, 'noneAnnounced' | 'noTmdbEntry'>
}> {
  const found = new Map<string, UpcomingEpisode>()
  const empty = new Map<string, 'noneAnnounced' | 'noTmdbEntry'>()
  const all = Promise.all(
    rows.map(async (row) => {
      const forecast = await getForecast(row.tmdb_id, apiKey)
      if (forecast?.next?.air_date) found.set(row.id, tmdbUpcomingEpisode(row.id, forecast.next))
      else if (forecast) empty.set(row.id, forecast.known ? 'noneAnnounced' : 'noTmdbEntry')
    })
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<'budget'>((resolve) => {
    timer = setTimeout(() => resolve('budget'), budgetMs)
  })
  const finished = await Promise.race([all, budget])
  clearTimeout(timer)

  if (finished === 'budget') {
    logger.warn(
      { lookups: rows.length, answered: found.size },
      'TMDb upcoming episode lookups ran past the request budget'
    )
  }
  // Copies: lookups still running must not change a map the caller is reading.
  return { found: new Map(found), empty: new Map(empty) }
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
    const apiKey = await getTMDbApiKey()
    if (apiKey) {
      const forecast = await getForecast(tmdbId, apiKey)
      if (forecast?.next?.air_date) return tmdbUpcomingEpisode(seriesId, forecast.next)
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
 * The batch Emby query always covers every id (single cheap query), and runs on
 * every call: only TMDb's answer is cached.
 */
export async function getUpcomingEpisodes(
  seriesIds: string[],
  options?: { tmdbFallbackIds?: Set<string>; forecastBudgetMs?: number }
): Promise<Map<string, UpcomingEpisode>> {
  return (await getUpcomingEpisodesReport(seriesIds, options)).episodes
}

/**
 * `getUpcomingEpisodes` for a caller that has to say why a show has nothing: the
 * same queries and the same forecast cache, plus a `gaps` entry for every show
 * without an episode. A lookup that failed is `lookupFailed`, never `noneAnnounced`.
 */
export async function getUpcomingEpisodesReport(
  seriesIds: string[],
  options?: { tmdbFallbackIds?: Set<string>; forecastBudgetMs?: number }
): Promise<UpcomingEpisodesReport> {
  const result = new Map<string, UpcomingEpisode>()
  const gaps = new Map<string, UpcomingGap>()

  if (seriesIds.length === 0) {
    return { episodes: result, gaps }
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
  for (const id of seriesIds) {
    if (!result.has(id) && options?.tmdbFallbackIds && !options.tmdbFallbackIds.has(id)) {
      gaps.set(id, 'notAsked')
    }
  }

  if (seriesNeedingTmdb.length > 0) {
    // Get TMDB IDs for these series
    const tmdbIds = await query<{ id: string; tmdb_id: string }>(
      `SELECT id, tmdb_id FROM series
       WHERE id = ANY($1) AND tmdb_id IS NOT NULL`,
      [seriesNeedingTmdb]
    )

    const withTmdbId = new Set(tmdbIds.rows.map((row) => row.id))
    for (const id of seriesNeedingTmdb) {
      if (!withTmdbId.has(id)) gaps.set(id, 'noTmdbEntry')
    }

    const apiKey = tmdbIds.rows.length > 0 ? await getTMDbApiKey() : null
    if (apiKey) {
      const { found, empty } = await lookUpForecasts(
        tmdbIds.rows,
        apiKey,
        options?.forecastBudgetMs ?? FORECAST_BATCH_BUDGET_MS
      )
      for (const [seriesId, episode] of found) result.set(seriesId, episode)
      for (const { id } of tmdbIds.rows) {
        if (!found.has(id)) gaps.set(id, empty.get(id) ?? 'lookupFailed')
      }
    } else {
      for (const { id } of tmdbIds.rows) gaps.set(id, 'noTmdbKey')
    }
  }

  return { episodes: result, gaps }
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
 * Per series, per season on the server: the highest episode number held and
 * the highest this viewer PLAYED (a favorited episode writes a watch_history
 * row too, and is not a watch). Feeds `wasCaughtUp`, and its keys are also the
 * seasons the server holds. Season 0 is included; callers decide about it.
 */
export async function getSeasonProgress(
  userId: string,
  seriesIds: string[]
): Promise<Map<string, Map<number, SeasonProgress>>> {
  const result = new Map<string, Map<number, SeasonProgress>>()
  if (seriesIds.length === 0) return result

  const rows = await query<{
    series_id: string
    season_number: number
    server_last: number | null
    played_last: number | null
  }>(
    `SELECT e.series_id, e.season_number,
            MAX(e.episode_number) AS server_last,
            MAX(e.episode_number) FILTER (WHERE wh.id IS NOT NULL) AS played_last
     FROM episodes e
     LEFT JOIN watch_history wh
       ON wh.episode_id = e.id AND wh.user_id = $2 AND ${WATCH_HISTORY_PLAYED_SQL}
     WHERE e.series_id = ANY($1) AND e.season_number IS NOT NULL
     GROUP BY e.series_id, e.season_number`,
    [seriesIds, userId]
  )

  for (const row of rows.rows) {
    let seasons = result.get(row.series_id)
    if (!seasons) {
      seasons = new Map()
      result.set(row.series_id, seasons)
    }
    seasons.set(row.season_number, {
      serverLastEpisode: row.server_last,
      playedLastEpisode: row.played_last,
    })
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

