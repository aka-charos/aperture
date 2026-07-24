/**
 * Series Episodes Handler
 * 
 * GET /api/series/:id/episodes - Get all episodes for a series, grouped by season
 */
import type { FastifyInstance } from 'fastify'
import { query } from '../../../lib/db.js'
import { requireAuth } from '../../../plugins/auth.js'
import { episodesSchema } from '../schemas.js'
import type { EpisodeRow } from '../types.js'

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

      return reply.send({
        episodes: result.rows,
        seasons,
        totalEpisodes: result.rows.length,
        seasonCount: Object.keys(seasons).length,
      })
    }
  )
}
