/**
 * Series Episodes Handler
 *
 * GET /api/series/:id/episodes - Get all episodes for a series, grouped by season,
 * with the current user's watch state and per-season availability (how many aired
 * episodes are actually on the media server).
 */
import type { FastifyInstance } from 'fastify'
import { getUpcomingEpisodeForSeries } from '@aperture/core/watching'
import { query, queryOne } from '../../../lib/db.js'
import { requireAuth } from '../../../plugins/auth.js'
import { episodesSchema } from '../schemas.js'
import type { EpisodeRow, SeasonAvailability, TmdbSeasonSummary } from '../types.js'

/**
 * Media-server status is often stale, so TMDB wins when cached. Mirrors
 * effectiveSeriesStatus in routes/watching — anything not ended counts as airing.
 */
function hasEnded(mediaServerStatus: string | null, tmdbStatus: string | null): boolean {
  const status = tmdbStatus || mediaServerStatus
  return status === 'Ended' || status === 'Canceled'
}

export function registerEpisodesHandler(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string } }>(
    '/api/series/:id/episodes',
    {
      preHandler: requireAuth,
      schema: episodesSchema,
    },
    async (request, reply) => {
      const { id } = request.params
      // requireAuth guarantees a user; null keeps the join valid if it is ever absent.
      const userId = request.user?.id ?? null

      // LEFT JOIN the current user's watch_history so each episode carries its
      // own played / in-progress state. The (user_id, episode_id) unique index
      // (migration 0045) guarantees at most one row per episode — no fan-out.
      const result = await query<EpisodeRow>(
        `SELECT e.id, e.season_number, e.episode_number, e.title, e.overview,
                e.premiere_date, e.runtime_minutes, e.community_rating, e.poster_url,
                COALESCE(wh.played, false) AS played,
                COALESCE(wh.play_count, 0) AS play_count,
                wh.last_played_at,
                CASE
                  WHEN wh.runtime_ticks IS NOT NULL AND wh.runtime_ticks > 0
                       AND wh.playback_position_ticks IS NOT NULL
                  THEN ROUND((wh.playback_position_ticks::numeric / wh.runtime_ticks) * 100)::int
                  ELSE NULL
                END AS progress_percent
         FROM episodes e
         LEFT JOIN watch_history wh
           ON wh.episode_id = e.id AND wh.user_id = $2
         WHERE e.series_id = $1
         ORDER BY e.season_number ASC, e.episode_number ASC`,
        [id, userId]
      )

      // Group by season
      const seasons: Record<number, EpisodeRow[]> = {}
      for (const ep of result.rows) {
        if (!seasons[ep.season_number]) {
          seasons[ep.season_number] = []
        }
        seasons[ep.season_number].push(ep)
      }

      const seasonAvailability = await buildSeasonAvailability(id, seasons)
      const missingEpisodes = seasonAvailability.reduce((sum, s) => sum + s.missing_episodes, 0)

      return reply.send({
        episodes: result.rows,
        seasons,
        totalEpisodes: result.rows.length,
        seasonCount: Object.keys(seasons).length,
        seasonAvailability,
        missingEpisodes,
      })
    }
  )
}

/**
 * Compare what the server holds per season against what TMDB says has aired.
 *
 * The season currently airing is capped at (next episode - 1), because TMDB's
 * episode_count for it includes announced-but-unaired episodes — without that
 * cap a half-aired season looks like it is missing content it never had.
 * Mirrors the aired math in routes/watching so both surfaces agree.
 */
async function buildSeasonAvailability(
  seriesId: string,
  seasons: Record<number, EpisodeRow[]>
): Promise<SeasonAvailability[]> {
  const seriesRow = await queryOne<{
    tmdb_id: string | null
    tmdb_seasons: TmdbSeasonSummary[] | null
    status: string | null
    tmdb_status: string | null
  }>(
    `SELECT tmdb_id, tmdb_seasons, status, tmdb_status FROM series WHERE id = $1`,
    [seriesId]
  )

  const today = new Date().toISOString().split('T')[0]
  const tmdbSeasons = (seriesRow?.tmdb_seasons ?? []).filter(
    (s) => s.season_number >= 1 && s.episode_count > 0
  )
  const airedSeasons = tmdbSeasons.filter((s) => s.air_date !== null && s.air_date <= today)

  // Only look up the next episode when a still-airing season could be capped —
  // for ended series every aired season is complete, so skip the TMDB lookup.
  const couldBeCapped =
    airedSeasons.length > 0 &&
    !hasEnded(seriesRow?.status ?? null, seriesRow?.tmdb_status ?? null) &&
    airedSeasons.some((s) => (seasons[s.season_number]?.length ?? 0) < s.episode_count)
  const upcoming = couldBeCapped
    ? await getUpcomingEpisodeForSeries(seriesId, seriesRow?.tmdb_id ?? null)
    : null

  const tmdbBySeason = new Map(tmdbSeasons.map((s) => [s.season_number, s]))
  const seasonNumbers = new Set<number>([
    ...Object.keys(seasons).map(Number),
    ...tmdbSeasons.map((s) => s.season_number),
  ])

  return [...seasonNumbers]
    .sort((a, b) => a - b)
    .map((seasonNumber) => {
      const onServer = seasons[seasonNumber]?.length ?? 0
      const tmdbSeason = tmdbBySeason.get(seasonNumber)
      // Specials (season 0) and seasons TMDB doesn't know about: report what we
      // hold, but never claim anything is missing.
      if (!tmdbSeason) {
        return {
          season_number: seasonNumber,
          episodes_on_server: onServer,
          tmdb_episode_count: null,
          aired_episodes: null,
          missing_episodes: 0,
          has_aired: true,
        }
      }

      const hasAired = tmdbSeason.air_date !== null && tmdbSeason.air_date <= today
      let aired = hasAired ? tmdbSeason.episode_count : 0
      if (hasAired && upcoming && upcoming.seasonNumber === seasonNumber) {
        aired = Math.min(tmdbSeason.episode_count, Math.max(0, upcoming.episodeNumber - 1))
      }

      return {
        season_number: seasonNumber,
        episodes_on_server: onServer,
        tmdb_episode_count: tmdbSeason.episode_count,
        aired_episodes: aired,
        missing_episodes: Math.max(0, aired - onServer),
        has_aired: hasAired,
      }
    })
}
