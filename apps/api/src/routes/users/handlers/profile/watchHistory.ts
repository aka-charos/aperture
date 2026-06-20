import type { FastifyInstance } from 'fastify'
import { query, queryOne } from '../../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../../plugins/auth.js'
import { requireSelfOrAdmin } from './shared.js'

export function registerWatchHistoryHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/users/:id/watch-history
   * Get user's watch history with pagination
   */
  fastify.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string; sortBy?: string; search?: string }
  }>(
    '/api/users/:id/watch-history',
    { preHandler: requireAuth, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser
      const page = parseInt(request.query.page || '1', 10)
      const pageSize = Math.min(parseInt(request.query.pageSize || '50', 10), 100)
      const sortBy = request.query.sortBy || 'recent' // recent, plays, title
      const search = (request.query.search || '').trim()

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      // Optional search across the entire history (title or any genre), not just the current page.
      // When present, it occupies $2 in both queries.
      const searchClause = search
        ? ' AND (m.title ILIKE $2 OR EXISTS (SELECT 1 FROM unnest(m.genres) g WHERE g ILIKE $2))'
        : ''
      const searchParams = search ? [`%${search}%`] : []

      // Get total count (only from enabled libraries)
      const countResult = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM watch_history wh
         JOIN movies m ON m.id = wh.movie_id
         JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
         WHERE wh.user_id = $1 AND lc.is_enabled = true${searchClause}`,
        [id, ...searchParams]
      )
      const total = parseInt(countResult?.count || '0', 10)

      // Build ORDER BY clause
      let orderBy = 'wh.last_played_at DESC NULLS LAST'
      if (sortBy === 'plays') {
        orderBy = 'wh.play_count DESC, wh.last_played_at DESC NULLS LAST'
      } else if (sortBy === 'title') {
        orderBy = 'm.title ASC'
      }

      const offset = (page - 1) * pageSize
      const limitIdx = search ? 3 : 2
      const offsetIdx = search ? 4 : 3

      const result = await query(
        `SELECT
           wh.movie_id,
           wh.play_count,
           wh.is_favorite,
           wh.last_played_at,
           wh.played,
           CASE
             WHEN wh.runtime_ticks IS NOT NULL AND wh.runtime_ticks > 0 AND wh.playback_position_ticks IS NOT NULL
             THEN ROUND((wh.playback_position_ticks::numeric / wh.runtime_ticks) * 100)::int
             ELSE NULL
           END as progress_percent,
           m.title,
           m.year,
           m.poster_url,
           m.genres,
           m.community_rating,
           m.overview
         FROM watch_history wh
         JOIN movies m ON m.id = wh.movie_id
         JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
         WHERE wh.user_id = $1 AND lc.is_enabled = true${searchClause}
         ORDER BY ${orderBy}
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [id, ...searchParams, pageSize, offset]
      )

      return reply.send({
        history: result.rows,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      })
    }
  )

  /**
   * GET /api/users/:id/series-watch-history
   * Get user's series watch history with pagination (grouped by series)
   */
  fastify.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string; sortBy?: string; search?: string }
  }>(
    '/api/users/:id/series-watch-history',
    { preHandler: requireAuth, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser
      const page = parseInt(request.query.page || '1', 10)
      const pageSize = Math.min(parseInt(request.query.pageSize || '50', 10), 100)
      const sortBy = request.query.sortBy || 'recent' // recent, plays, title
      const search = (request.query.search || '').trim()

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      // Optional search across the entire history (title or any genre), not just the current page.
      // When present, it occupies $2 in both queries.
      const searchClause = search
        ? ' AND (s.title ILIKE $2 OR EXISTS (SELECT 1 FROM unnest(s.genres) g WHERE g ILIKE $2))'
        : ''
      const searchParams = search ? [`%${search}%`] : []

      // Get total count of distinct series watched (only from enabled libraries)
      const countResult = await queryOne<{ count: string }>(
        `SELECT COUNT(DISTINCT s.id) as count
         FROM watch_history wh
         JOIN episodes e ON e.id = wh.episode_id
         JOIN series s ON s.id = e.series_id
         LEFT JOIN library_config lc ON lc.provider_library_id = s.provider_library_id
         WHERE wh.user_id = $1
           AND wh.episode_id IS NOT NULL
           AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)${searchClause}`,
        [id, ...searchParams]
      )
      const total = parseInt(countResult?.count || '0', 10)

      // Build ORDER BY clause
      let orderBy = 'MAX(wh.last_played_at) DESC NULLS LAST'
      if (sortBy === 'plays') {
        orderBy = 'SUM(wh.play_count) DESC, MAX(wh.last_played_at) DESC NULLS LAST'
      } else if (sortBy === 'title') {
        orderBy = 's.title ASC'
      }

      const offset = (page - 1) * pageSize
      const limitIdx = search ? 3 : 2
      const offsetIdx = search ? 4 : 3

      // Group by series to get aggregate watch data
      const result = await query(
        `SELECT
           s.id as series_id,
           s.title,
           s.year,
           s.poster_url,
           s.genres,
           s.community_rating,
           s.overview,
           COUNT(DISTINCT e.id) as episodes_watched,
           (SELECT COUNT(*) FROM episodes WHERE series_id = s.id) as total_episodes,
           SUM(wh.play_count)::int as total_plays,
           MAX(wh.last_played_at) as last_played_at,
           BOOL_OR(wh.is_favorite) as is_favorite
         FROM watch_history wh
         JOIN episodes e ON e.id = wh.episode_id
         JOIN series s ON s.id = e.series_id
         LEFT JOIN library_config lc ON lc.provider_library_id = s.provider_library_id
         WHERE wh.user_id = $1
           AND wh.episode_id IS NOT NULL
           AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)${searchClause}
         GROUP BY s.id, s.title, s.year, s.poster_url, s.genres, s.community_rating, s.overview
         ORDER BY ${orderBy}
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [id, ...searchParams, pageSize, offset]
      )

      return reply.send({
        history: result.rows,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      })
    }
  )
}
