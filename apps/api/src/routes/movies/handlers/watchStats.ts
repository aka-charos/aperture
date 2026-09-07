/**
 * Movie Watch Stats Handler
 * 
 * GET /api/movies/:id/watch-stats - Get comprehensive watch statistics for a movie
 */
import type { FastifyInstance } from 'fastify'
import { WATCH_HISTORY_PLAYED_SQL } from '@aperture/core'
import { queryOne } from '../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'
import {
  resolveWatcherAudience,
  fetchMovieWatchers,
} from '../../../lib/watcherVisibility.js'
import { watchStatsSchema } from '../schemas.js'

export function registerWatchStatsHandler(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string } }>(
    '/api/movies/:id/watch-stats',
    {
      preHandler: requireAuth,
      schema: watchStatsSchema,
    },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser

      // Get watch history stats
      const watchStats = await queryOne<{
        total_watchers: string
        total_plays: string
        favorites_count: string
        first_watched: Date | null
        last_watched: Date | null
      }>(
        // "Watched" is played, not "has a row": favoriting an unwatched film
        // writes one, so the counter used to include people who had only
        // bookmarked it — and the named list beside it then said their name.
        // favorites_count keeps counting every favorite, which is its own
        // question; it is a FILTER rather than a WHERE for exactly that reason.
        `SELECT
          COUNT(DISTINCT wh.user_id) FILTER (WHERE ${WATCH_HISTORY_PLAYED_SQL}) as total_watchers,
          COALESCE(SUM(wh.play_count) FILTER (WHERE ${WATCH_HISTORY_PLAYED_SQL}), 0) as total_plays,
          COUNT(DISTINCT CASE WHEN wh.is_favorite THEN wh.user_id END) as favorites_count,
          MIN(wh.last_played_at) FILTER (WHERE ${WATCH_HISTORY_PLAYED_SQL}) as first_watched,
          MAX(wh.last_played_at) FILTER (WHERE ${WATCH_HISTORY_PLAYED_SQL}) as last_watched
         FROM watch_history wh
         WHERE wh.movie_id = $1`,
        [id]
      )

      // Get user ratings stats
      const ratingStats = await queryOne<{
        avg_rating: string | null
        rating_count: string
        rating_distribution: string
      }>(
        `SELECT 
          AVG(rating)::numeric(3,1) as avg_rating,
          COUNT(*) as rating_count,
          json_object_agg(rating, count) as rating_distribution
         FROM (
           SELECT rating, COUNT(*) as count 
           FROM user_ratings 
           WHERE movie_id = $1 
           GROUP BY rating
         ) r`,
        [id]
      )

      // Get total user count for percentage calculation
      const userCount = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM users`
      )
      const totalUsers = parseInt(userCount?.count || '1', 10)
      const watchers = parseInt(watchStats?.total_watchers || '0', 10)

      // Names ride the same response as the counts, decided here rather than
      // filtered in the client: a viewer with no visibility never receives them.
      const watcherList = await fetchMovieWatchers(id, resolveWatcherAudience(currentUser))

      return reply.send({
        totalWatchers: watchers,
        ...(watcherList ? { watchers: watcherList } : {}),
        totalPlays: parseInt(watchStats?.total_plays || '0', 10),
        favoritesCount: parseInt(watchStats?.favorites_count || '0', 10),
        firstWatched: watchStats?.first_watched || null,
        lastWatched: watchStats?.last_watched || null,
        // User ratings
        averageUserRating: ratingStats?.avg_rating ? parseFloat(ratingStats.avg_rating) : null,
        totalRatings: parseInt(ratingStats?.rating_count || '0', 10),
        // Percentage of users who watched
        watchPercentage: totalUsers > 0 ? Math.round((watchers / totalUsers) * 100) : 0,
        totalUsers,
      })
    }
  )
}
