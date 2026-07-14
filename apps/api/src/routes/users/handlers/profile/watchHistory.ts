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
    Querystring: { page?: string; pageSize?: string; sortBy?: string; search?: string; filter?: string }
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
      const filter = request.query.filter || 'all' // all, completed, in_progress

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      // Optional search across the entire history (title or any genre), not just the current page.
      // When present, it occupies $2 in both queries.
      const searchClause = search
        ? ' AND (m.title ILIKE $2 OR EXISTS (SELECT 1 FROM unnest(m.genres) g WHERE g ILIKE $2))'
        : ''
      const searchParams = search ? [`%${search}%`] : []

      // Watch-status filter (literal SQL, no bound params).
      // "all" deliberately excludes bookmark-only favorites (favorited but never played),
      // which otherwise pollute the history with items the user never actually watched.
      let statusClause: string
      if (filter === 'completed') {
        statusClause = ' AND wh.played = true'
      } else if (filter === 'in_progress') {
        statusClause = ' AND wh.played = false AND COALESCE(wh.playback_position_ticks, 0) > 0'
      } else {
        statusClause =
          ' AND (wh.played = true OR wh.play_count > 0 OR COALESCE(wh.playback_position_ticks, 0) > 0)'
      }

      // Get total count (only from enabled libraries)
      const countResult = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM watch_history wh
         JOIN movies m ON m.id = wh.movie_id
         JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
         WHERE wh.user_id = $1 AND lc.is_enabled = true${searchClause}${statusClause}`,
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
         WHERE wh.user_id = $1 AND lc.is_enabled = true${searchClause}${statusClause}
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
    Querystring: { page?: string; pageSize?: string; sortBy?: string; search?: string; filter?: string }
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
      const filter = request.query.filter || 'all' // all, completed, in_progress

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      // Optional search across the entire history (title or any genre), not just the current page.
      // When present, it occupies $2 in both queries.
      const searchClause = search
        ? ' AND (s.title ILIKE $2 OR EXISTS (SELECT 1 FROM unnest(s.genres) g WHERE g ILIKE $2))'
        : ''
      const searchParams = search ? [`%${search}%`] : []

      // Aggregate expressions used to classify a series (all literal SQL, no bound params).
      // An episode counts as "watched" once fully played; "active" also includes in-progress resumes.
      // Bookmark-only favorites (favorited but never played/resumed) contribute nothing, so a
      // series with only such rows is excluded from every view — matching the movie behaviour.
      const watchedExpr = 'COUNT(DISTINCT e.id) FILTER (WHERE wh.played = true OR wh.play_count > 0)'
      const activeExpr =
        'COUNT(DISTINCT e.id) FILTER (WHERE wh.played = true OR wh.play_count > 0 OR COALESCE(wh.playback_position_ticks, 0) > 0)'
      const totalExpr = '(SELECT COUNT(*) FROM episodes WHERE series_id = s.id)'
      let havingClause: string
      if (filter === 'completed') {
        havingClause = `HAVING ${totalExpr} > 0 AND ${watchedExpr} >= ${totalExpr}`
      } else if (filter === 'in_progress') {
        havingClause = `HAVING ${activeExpr} > 0 AND ${watchedExpr} < ${totalExpr}`
      } else {
        havingClause = `HAVING ${activeExpr} > 0`
      }

      // Get total count of distinct series matching the filter (only from enabled libraries)
      const countResult = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM (
           SELECT s.id
           FROM watch_history wh
           JOIN episodes e ON e.id = wh.episode_id
           JOIN series s ON s.id = e.series_id
           LEFT JOIN library_config lc ON lc.provider_library_id = s.provider_library_id
           WHERE wh.user_id = $1
             AND wh.episode_id IS NOT NULL
             AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)${searchClause}
           GROUP BY s.id
           ${havingClause}
         ) sub`,
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
           ${watchedExpr} as episodes_watched,
           ${totalExpr} as total_episodes,
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
         ${havingClause}
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
