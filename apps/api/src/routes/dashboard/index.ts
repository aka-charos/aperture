import type { FastifyPluginAsync } from 'fastify'
import { query, queryOne } from '../../lib/db.js'
import { requireAuth, type SessionUser } from '../../plugins/auth.js'
import { dashboardSchemas, getDashboardSchema } from './schemas.js'

interface DashboardStats {
  moviesWatched: number
  seriesWatched: number
  ratingsCount: number
  watchTimeMinutes: number
}

interface DashboardRecommendation {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  matchScore: number | null
  /** Movie only */
  runtimeMinutes?: number | null
  /** Series only */
  totalSeasons?: number | null
  totalEpisodes?: number | null
}

interface DashboardTopPick {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  rank: number
  popularityScore: number
}

interface DashboardRecentWatch {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
  lastWatched: Date
  playCount: number
  lastEpisode?: {
    seasonNumber: number
    episodeNumber: number
  }
}

interface DashboardRecentRating {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
  rating: number
  ratedAt: Date
}

interface DashboardResponse {
  stats: DashboardStats
  recommendations: DashboardRecommendation[]
  topPicks: DashboardTopPick[]
  recentWatches: DashboardRecentWatch[]
  recentRatings: DashboardRecentRating[]
}

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  // Register schemas
  for (const [name, schema] of Object.entries(dashboardSchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  /**
   * GET /api/dashboard
   * Get aggregated dashboard data for the current user
   */
  fastify.get<{ Reply: DashboardResponse }>(
    '/api/dashboard',
    { preHandler: requireAuth, schema: getDashboardSchema },
    async (request, reply) => {
      const user = request.user as SessionUser
      const { getTopMovies, getTopSeries } = await import('@aperture/core')

      // Run all queries in parallel for performance
      const [
        statsResult,
        movieRecsResult,
        seriesRecsResult,
        popularMovies,
        popularSeries,
        recentMovieWatchesResult,
        recentSeriesWatchesResult,
        recentRatingsResult,
      ] = await Promise.all([
        // Stats query
        queryOne<{
          movies_watched: string
          series_watched: string
          ratings_count: string
          watch_time_minutes: string
        }>(
          `
          SELECT 
            COALESCE((
              SELECT COUNT(DISTINCT movie_id) 
              FROM watch_history 
              WHERE user_id = $1 AND movie_id IS NOT NULL
            ), 0) as movies_watched,
            COALESCE((
              SELECT COUNT(DISTINCT e.series_id) 
              FROM watch_history wh
              JOIN episodes e ON e.id = wh.episode_id
              WHERE wh.user_id = $1 AND wh.episode_id IS NOT NULL
            ), 0) as series_watched,
            COALESCE((
              SELECT COUNT(*) FROM user_ratings WHERE user_id = $1
            ), 0) as ratings_count,
            COALESCE((
              SELECT COALESCE(SUM(m.runtime_minutes), 0)
              FROM watch_history wh
              JOIN movies m ON m.id = wh.movie_id
              WHERE wh.user_id = $1 AND wh.movie_id IS NOT NULL
            ), 0) as watch_time_minutes
        `,
          [user.id]
        ),

        // Movie recommendations — the latest completed run only. Reading
        // across runs backfills the tail with the previous run's picks, which
        // shows up as the same title twice in one row.
        query<{
          movie_id: string
          title: string
          year: number | null
          poster_url: string | null
          genres: string[]
          final_score: number | null
          runtime_minutes: number | null
        }>(
          `
          SELECT
            rc.movie_id,
            m.title,
            m.year,
            m.poster_url,
            m.genres,
            rc.final_score,
            m.runtime_minutes
          FROM recommendation_candidates rc
          JOIN movies m ON m.id = rc.movie_id
          WHERE rc.run_id = (
              SELECT id FROM recommendation_runs
              WHERE user_id = $1 AND status = 'completed' AND media_type = 'movie'
              ORDER BY created_at DESC
              LIMIT 1
            )
            AND rc.is_selected = true
            AND rc.movie_id IS NOT NULL
          ORDER BY rc.selected_rank ASC NULLS LAST
        `,
          [user.id]
        ),

        // Series recommendations — latest completed run only, as above
        query<{
          series_id: string
          title: string
          year: number | null
          poster_url: string | null
          genres: string[]
          final_score: number | null
          total_seasons: number | null
          total_episodes: number | null
        }>(
          `
          SELECT
            rc.series_id,
            s.title,
            s.year,
            s.poster_url,
            s.genres,
            rc.final_score,
            s.total_seasons,
            s.total_episodes
          FROM recommendation_candidates rc
          JOIN series s ON s.id = rc.series_id
          WHERE rc.run_id = (
              SELECT id FROM recommendation_runs
              WHERE user_id = $1 AND status = 'completed' AND media_type = 'series'
              ORDER BY created_at DESC
              LIMIT 1
            )
            AND rc.is_selected = true
            AND rc.series_id IS NOT NULL
          ORDER BY rc.selected_rank ASC NULLS LAST
        `,
          [user.id]
        ),

        // Top picks — same source of truth as the /top-picks page, so the
        // configured source, weights, filters and list size all apply here
        // too. A failure there costs the carousel, not the whole dashboard.
        getTopMovies().catch((err) => {
          fastify.log.error({ err }, 'Failed to load top picks movies for dashboard')
          return []
        }),
        getTopSeries().catch((err) => {
          fastify.log.error({ err }, 'Failed to load top picks series for dashboard')
          return []
        }),

        // Recent movie watches (3)
        query<{
          movie_id: string
          title: string
          year: number | null
          poster_url: string | null
          last_played_at: Date
          play_count: number
        }>(
          `
          SELECT 
            m.id as movie_id,
            m.title,
            m.year,
            m.poster_url,
            wh.last_played_at,
            wh.play_count
          FROM watch_history wh
          JOIN movies m ON m.id = wh.movie_id
          WHERE wh.user_id = $1 
            AND wh.movie_id IS NOT NULL
            AND wh.last_played_at IS NOT NULL
          ORDER BY wh.last_played_at DESC NULLS LAST
          LIMIT 3
        `,
          [user.id]
        ),

        // Recent series watches (3) - includes last watched episode info
        query<{
          series_id: string
          title: string
          year: number | null
          poster_url: string | null
          last_played_at: Date
          play_count: number
          season_number: number
          episode_number: number
        }>(
          `
          WITH ranked_watches AS (
            SELECT 
              s.id as series_id,
              s.title,
              s.year,
              s.poster_url,
              wh.last_played_at,
              wh.play_count,
              e.season_number,
              e.episode_number,
              ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY wh.last_played_at DESC) as rn
            FROM watch_history wh
            JOIN episodes e ON e.id = wh.episode_id
            JOIN series s ON s.id = e.series_id
            WHERE wh.user_id = $1 
              AND wh.episode_id IS NOT NULL
              AND wh.last_played_at IS NOT NULL
          )
          SELECT 
            series_id,
            title,
            year,
            poster_url,
            last_played_at,
            play_count,
            season_number,
            episode_number
          FROM ranked_watches
          WHERE rn = 1
          ORDER BY last_played_at DESC
          LIMIT 3
        `,
          [user.id]
        ),

        // Recent ratings (5)
        query<{
          id: string
          movie_id: string | null
          series_id: string | null
          rating: number
          updated_at: Date
          title: string
          year: number | null
          poster_url: string | null
        }>(
          `
          (
            SELECT 
              ur.id,
              ur.movie_id,
              NULL::uuid as series_id,
              ur.rating,
              ur.updated_at,
              m.title,
              m.year,
              m.poster_url
            FROM user_ratings ur
            JOIN movies m ON m.id = ur.movie_id
            WHERE ur.user_id = $1 AND ur.movie_id IS NOT NULL
          )
          UNION ALL
          (
            SELECT 
              ur.id,
              NULL::uuid as movie_id,
              ur.series_id,
              ur.rating,
              ur.updated_at,
              s.title,
              s.year,
              s.poster_url
            FROM user_ratings ur
            JOIN series s ON s.id = ur.series_id
            WHERE ur.user_id = $1 AND ur.series_id IS NOT NULL
          )
          ORDER BY updated_at DESC
          LIMIT 5
        `,
          [user.id]
        ),
      ])

      // Build stats
      const stats: DashboardStats = {
        moviesWatched: parseInt(statsResult?.movies_watched || '0', 10),
        seriesWatched: parseInt(statsResult?.series_watched || '0', 10),
        ratingsCount: parseInt(statsResult?.ratings_count || '0', 10),
        watchTimeMinutes: parseInt(statsResult?.watch_time_minutes || '0', 10),
      }

      // Build recommendations (interleave movies and series)
      const movieRecs = movieRecsResult.rows.map((r) => ({
        id: r.movie_id,
        type: 'movie' as const,
        title: r.title,
        year: r.year,
        posterUrl: r.poster_url,
        genres: r.genres || [],
        matchScore: r.final_score ? Math.round(r.final_score * 100) : null,
        runtimeMinutes: r.runtime_minutes,
      }))
      const seriesRecs = seriesRecsResult.rows.map((r) => ({
        id: r.series_id,
        type: 'series' as const,
        title: r.title,
        year: r.year,
        posterUrl: r.poster_url,
        genres: r.genres || [],
        matchScore: r.final_score ? Math.round(r.final_score * 100) : null,
        totalSeasons: r.total_seasons,
        totalEpisodes: r.total_episodes,
      }))
      // Interleave: movie, series, movie, series, ...
      const recommendations: DashboardRecommendation[] = []
      const maxLen = Math.max(movieRecs.length, seriesRecs.length)
      for (let i = 0; i < maxLen; i++) {
        if (movieRecs[i]) recommendations.push(movieRecs[i])
        if (seriesRecs[i]) recommendations.push(seriesRecs[i])
      }

      // Build top picks (interleave movies and series)
      const topMovies = popularMovies.map((m) => ({
        id: m.movieId,
        type: 'movie' as const,
        title: m.title,
        year: m.year,
        posterUrl: m.posterUrl,
        genres: m.genres || [],
        rank: m.rank,
        popularityScore: m.popularityScore,
      }))
      const topSeries = popularSeries.map((s) => ({
        id: s.seriesId,
        type: 'series' as const,
        title: s.title,
        year: s.year,
        posterUrl: s.posterUrl,
        genres: s.genres || [],
        rank: s.rank,
        popularityScore: s.popularityScore,
      }))
      const topPicks: DashboardTopPick[] = []
      const maxTopLen = Math.max(topMovies.length, topSeries.length)
      for (let i = 0; i < maxTopLen; i++) {
        if (topMovies[i]) topPicks.push(topMovies[i])
        if (topSeries[i]) topPicks.push(topSeries[i])
      }

      // Build recent watches (interleave and sort by date)
      const recentMovieWatches = recentMovieWatchesResult.rows.map((r) => ({
        id: r.movie_id,
        type: 'movie' as const,
        title: r.title,
        year: r.year,
        posterUrl: r.poster_url,
        lastWatched: r.last_played_at,
        playCount: r.play_count,
      }))
      const recentSeriesWatches = recentSeriesWatchesResult.rows.map((r) => ({
        id: r.series_id,
        type: 'series' as const,
        title: r.title,
        year: r.year,
        posterUrl: r.poster_url,
        lastWatched: r.last_played_at,
        playCount: r.play_count,
        lastEpisode: {
          seasonNumber: r.season_number,
          episodeNumber: r.episode_number,
        },
      }))
      const recentWatches: DashboardRecentWatch[] = [...recentMovieWatches, ...recentSeriesWatches]
        .sort((a, b) => new Date(b.lastWatched).getTime() - new Date(a.lastWatched).getTime())
        .slice(0, 6)

      // Build recent ratings
      const recentRatings: DashboardRecentRating[] = recentRatingsResult.rows.map((r) => ({
        id: r.movie_id || r.series_id || r.id,
        type: r.movie_id ? ('movie' as const) : ('series' as const),
        title: r.title,
        year: r.year,
        posterUrl: r.poster_url,
        rating: r.rating,
        ratedAt: r.updated_at,
      }))

      return reply.send({
        stats,
        recommendations,
        topPicks,
        recentWatches,
        recentRatings,
      })
    }
  )
}

export default dashboardRoutes
