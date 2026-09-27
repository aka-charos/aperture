import type { FastifyInstance } from 'fastify'
import { query, queryOne } from '../../../../lib/db.js'
import { scopeClause, viewerScope } from '../../../../lib/viewerScope.js'
import { requireAuth, type SessionUser } from '../../../../plugins/auth.js'
import { connectedReadNeedsScope, requireSelfOrAdminOrConnected } from './shared.js'

/**
 * The two watch-history LISTS. Self, an admin, or a visible connection of the
 * target may read them (`requireSelfOrAdminOrConnected`); everything that
 * EDITS a history lives in watchHistoryManagement.ts and stays self-or-admin.
 *
 * A connection reading someone else's history sees only titles in their OWN
 * library scope, applied to the count and the page alike so the two agree.
 * Placeholders are numbered as values are pushed and never renumbered
 * afterwards (F-130 rule 5).
 */
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

      if (!(await requireSelfOrAdminOrConnected(id, currentUser, reply))) return

      const params: unknown[] = [id]

      // Optional search across the entire history (title or any genre), not just the current page.
      let searchClause = ''
      if (search) {
        params.push(`%${search}%`)
        const p = `$${params.length}`
        searchClause = ` AND (m.title ILIKE ${p} OR EXISTS (SELECT 1 FROM unnest(m.genres) g WHERE g ILIKE ${p}))`
      }

      // Someone else's history, read as a connection: only titles the reader can open.
      const scopeFilter = connectedReadNeedsScope(id, currentUser)
        ? ` AND ${scopeClause(await viewerScope(request), 'm', params)}`
        : ''

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
         WHERE wh.user_id = $1 AND lc.is_enabled = true${searchClause}${scopeFilter}${statusClause}`,
        params
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
      const pageParams = [...params, pageSize, offset]

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
         WHERE wh.user_id = $1 AND lc.is_enabled = true${searchClause}${scopeFilter}${statusClause}
         ORDER BY ${orderBy}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        pageParams
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

      if (!(await requireSelfOrAdminOrConnected(id, currentUser, reply))) return

      const params: unknown[] = [id]

      // Optional search across the entire history (title or any genre), not just the current page.
      let searchClause = ''
      if (search) {
        params.push(`%${search}%`)
        const p = `$${params.length}`
        searchClause = ` AND (s.title ILIKE ${p} OR EXISTS (SELECT 1 FROM unnest(s.genres) g WHERE g ILIKE ${p}))`
      }

      // Someone else's history, read as a connection: only titles the reader can open.
      const scopeFilter = connectedReadNeedsScope(id, currentUser)
        ? ` AND ${scopeClause(await viewerScope(request), 's', params)}`
        : ''

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
             AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)${searchClause}${scopeFilter}
           GROUP BY s.id
           ${havingClause}
         ) sub`,
        params
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
      const pageParams = [...params, pageSize, offset]

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
           AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)${searchClause}${scopeFilter}
         GROUP BY s.id, s.title, s.year, s.poster_url, s.genres, s.community_rating, s.overview
         ${havingClause}
         ORDER BY ${orderBy}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        pageParams
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
