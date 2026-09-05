import type { FastifyInstance } from 'fastify'
import { query, queryOne } from '../../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../../plugins/auth.js'
import { requireSelfOrAdmin } from './shared.js'
import { WATCHED_SQL } from './watchStatsFilters.js'

export function registerWatchStatsHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/users/:id/watch-stats
   * Get comprehensive watch statistics for visualizations
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/users/:id/watch-stats',
    { preHandler: requireAuth, schema: { tags: ['users'] } },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      // The drill-in behind each number filters on the same predicate, so it
      // is shared rather than restated (see watchStatsFilters.ts).
      const WATCHED = WATCHED_SQL

      try {
        // Genre distribution for movies
        const genreResult = await query<{ genre: string; count: string }>(
          `WITH watched_movies AS (
             SELECT m.genres
             FROM watch_history wh
             JOIN movies m ON m.id = wh.movie_id
             LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
             WHERE wh.user_id = $1
               AND wh.movie_id IS NOT NULL
               AND ${WATCHED}
               AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)
           )
           SELECT g.genre, COUNT(*) as count
           FROM watched_movies wm, unnest(wm.genres) as g(genre)
           GROUP BY g.genre
           ORDER BY count DESC
           LIMIT 15`,
          [id]
        )

        const totalGenreCount = genreResult.rows.reduce((sum, r) => sum + parseInt(r.count), 0)
        const genreDistribution = genreResult.rows.map(r => ({
          genre: r.genre,
          count: parseInt(r.count),
          percentage: totalGenreCount > 0 ? Math.round((parseInt(r.count) / totalGenreCount) * 100) : 0
        }))

        // Watch timeline (monthly activity for last 12 months)
        const timelineResult = await query<{
          month: string
          month_key: string
          movies: string
          episodes: string
        }>(
          `WITH months AS (
             SELECT generate_series(
               date_trunc('month', NOW() - INTERVAL '11 months'),
               date_trunc('month', NOW()),
               '1 month'::interval
             ) as month
           ),
           movie_counts AS (
             SELECT date_trunc('month', wh.last_played_at) as month, COUNT(*) as count
             FROM watch_history wh
             JOIN movies m ON m.id = wh.movie_id
             LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
             WHERE wh.user_id = $1
               AND wh.movie_id IS NOT NULL
               AND ${WATCHED}
               AND wh.last_played_at >= NOW() - INTERVAL '12 months'
               AND wh.approximate_played_at IS NULL
               AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)
             GROUP BY date_trunc('month', wh.last_played_at)
           ),
           episode_counts AS (
             SELECT date_trunc('month', wh.last_played_at) as month, COUNT(*) as count
             FROM watch_history wh
             WHERE wh.user_id = $1
               AND wh.episode_id IS NOT NULL
               AND ${WATCHED}
               AND wh.last_played_at >= NOW() - INTERVAL '12 months'
               AND wh.approximate_played_at IS NULL
             GROUP BY date_trunc('month', wh.last_played_at)
           )
           SELECT 
             to_char(m.month, 'Mon YYYY') as month,
             to_char(m.month, 'YYYY-MM') as month_key,
             COALESCE(mc.count, 0) as movies,
             COALESCE(ec.count, 0) as episodes
           FROM months m
           LEFT JOIN movie_counts mc ON mc.month = m.month
           LEFT JOIN episode_counts ec ON ec.month = m.month
           ORDER BY m.month ASC`,
          [id]
        )

        const watchTimeline = timelineResult.rows.map(r => ({
          month: r.month,
          monthKey: r.month_key,
          movies: parseInt(r.movies),
          episodes: parseInt(r.episodes)
        }))

        // Decade distribution
        const decadeResult = await query<{ decade: string; count: string }>(
          `SELECT 
             CONCAT(FLOOR(m.year / 10) * 10, 's') as decade,
             COUNT(*) as count
           FROM watch_history wh
           JOIN movies m ON m.id = wh.movie_id
           LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
           WHERE wh.user_id = $1
             AND wh.movie_id IS NOT NULL
             AND ${WATCHED}
             AND m.year IS NOT NULL
             AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)
           GROUP BY FLOOR(m.year / 10) * 10
           ORDER BY FLOOR(m.year / 10) * 10 DESC`,
          [id]
        )

        const decadeDistribution = decadeResult.rows.map(r => ({
          decade: r.decade,
          count: parseInt(r.count)
        }))

        // Rating distribution (rounded to nearest 0.5)
        const ratingResult = await query<{ rating: string; count: string }>(
          `SELECT 
             ROUND(m.community_rating * 2) / 2 as rating,
             COUNT(*) as count
           FROM watch_history wh
           JOIN movies m ON m.id = wh.movie_id
           LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
           WHERE wh.user_id = $1
             AND wh.movie_id IS NOT NULL
             AND ${WATCHED}
             AND m.community_rating IS NOT NULL
             AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)
           GROUP BY ROUND(m.community_rating * 2) / 2
           ORDER BY rating ASC`,
          [id]
        )

        const ratingDistribution = ratingResult.rows.map(r => ({
          rating: parseFloat(r.rating).toFixed(1),
          count: parseInt(r.count)
        }))

        // Totals
        const totalsResult = await queryOne<{
          total_movies: string
          total_episodes: string
          total_runtime: string
          total_plays: string
          favorites: string
        }>(
          `SELECT
             (SELECT COUNT(*) FROM watch_history wh
              JOIN movies m ON m.id = wh.movie_id
              LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
              WHERE wh.user_id = $1 AND wh.movie_id IS NOT NULL AND ${WATCHED}
                AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)) as total_movies,
             (SELECT COUNT(*) FROM watch_history wh
              WHERE wh.user_id = $1 AND wh.episode_id IS NOT NULL AND ${WATCHED}) as total_episodes,
             (SELECT COALESCE(SUM(m.runtime_minutes), 0) FROM watch_history wh
              JOIN movies m ON m.id = wh.movie_id
              LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
              WHERE wh.user_id = $1 AND wh.movie_id IS NOT NULL AND ${WATCHED}
                AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)) as total_runtime,
             (SELECT COALESCE(SUM(wh.play_count), 0) FROM watch_history wh
              JOIN movies m ON m.id = wh.movie_id
              LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
              WHERE wh.user_id = $1 AND wh.movie_id IS NOT NULL AND ${WATCHED}
                AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)) as total_plays,
             (SELECT COUNT(*) FROM watch_history wh
              JOIN movies m ON m.id = wh.movie_id
              LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
              WHERE wh.user_id = $1 AND wh.is_favorite = true AND wh.movie_id IS NOT NULL
                AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)) as favorites`,
          [id]
        )

        // Top actors (from JSONB actors column) - with thumbnails
        // Get media server base URL for constructing person image URLs
        const { getMediaServerConfig } = await import('@aperture/core')
        const mediaServerConfig = await getMediaServerConfig()
        const mediaServerBaseUrl = mediaServerConfig.baseUrl || ''

        const actorsResult = await query<{ name: string; count: string }>(
          `WITH watched_movies AS (
             SELECT m.actors
             FROM watch_history wh
             JOIN movies m ON m.id = wh.movie_id
             LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
             WHERE wh.user_id = $1
               AND wh.movie_id IS NOT NULL
               AND ${WATCHED}
               AND m.actors IS NOT NULL
               AND jsonb_array_length(m.actors) > 0
               AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)
           )
           SELECT actor->>'name' as name, COUNT(*) as count
           FROM watched_movies wm, jsonb_array_elements(wm.actors) as actor
           WHERE actor->>'name' IS NOT NULL AND actor->>'name' != ''
           GROUP BY actor->>'name'
           ORDER BY count DESC
           LIMIT 10`,
          [id]
        )

        // Construct person image URLs using Emby/Jellyfin API format: /Persons/{Name}/Images/Primary
        const topActors = actorsResult.rows.map(r => ({
          name: r.name,
          thumb: mediaServerBaseUrl
            ? `${mediaServerBaseUrl}/Persons/${encodeURIComponent(r.name)}/Images/Primary`
            : null,
          count: parseInt(r.count)
        }))

        // Top directors
        const directorsResult = await query<{ name: string; count: string }>(
          `WITH watched_movies AS (
             SELECT m.directors
             FROM watch_history wh
             JOIN movies m ON m.id = wh.movie_id
             LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
             WHERE wh.user_id = $1
               AND wh.movie_id IS NOT NULL
               AND ${WATCHED}
               AND m.directors IS NOT NULL
               AND array_length(m.directors, 1) > 0
               AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)
           )
           SELECT d.name, COUNT(*) as count
           FROM watched_movies wm, unnest(wm.directors) as d(name)
           GROUP BY d.name
           ORDER BY count DESC
           LIMIT 10`,
          [id]
        )

        // Construct person image URLs for directors using Emby/Jellyfin API format
        const topDirectors = directorsResult.rows.map(r => ({
          name: r.name,
          thumb: mediaServerBaseUrl
            ? `${mediaServerBaseUrl}/Persons/${encodeURIComponent(r.name)}/Images/Primary`
            : null,
          count: parseInt(r.count)
        }))

        // Top studios (from movies) - studios is now JSONB with {id, name}
        // Joins with studios_networks table to get TMDB logo data
        const studiosResult = await query<{
          id: string | null
          name: string
          count: string
          logo_path: string | null
          logo_local_path: string | null
        }>(
          `WITH watched_movies AS (
             SELECT m.studios
             FROM watch_history wh
             JOIN movies m ON m.id = wh.movie_id
             LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
             WHERE wh.user_id = $1
               AND wh.movie_id IS NOT NULL
               AND ${WATCHED}
               AND m.studios IS NOT NULL
               AND jsonb_array_length(m.studios) > 0
               AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)
           ),
           all_studios AS (
             SELECT jsonb_array_elements(wm.studios) as studio_obj
             FROM watched_movies wm
           ),
           studio_counts AS (
             SELECT 
               studio_obj->>'id' as id,
               studio_obj->>'name' as name,
               COUNT(*) as count
             FROM all_studios
             WHERE studio_obj->>'name' IS NOT NULL
             GROUP BY studio_obj->>'id', studio_obj->>'name'
             ORDER BY count DESC
             LIMIT 10
           )
           SELECT 
             sc.id,
             sc.name,
             sc.count,
             sn.logo_path,
             sn.logo_local_path
           FROM studio_counts sc
           LEFT JOIN studios_networks sn ON sn.name = sc.name AND sn.type = 'studio'
           ORDER BY sc.count DESC`,
          [id]
        )

        // Construct studio image URLs - prefer local path, then TMDB, then Emby
        const topStudios = studiosResult.rows.map(r => {
          let thumb: string | null = null
          if (r.logo_local_path) {
            thumb = `/api/uploads/${r.logo_local_path}`
          } else if (r.logo_path) {
            thumb = `https://image.tmdb.org/t/p/w185${r.logo_path}`
          } else if (mediaServerBaseUrl && r.id) {
            thumb = `${mediaServerBaseUrl}/Items/${r.id}/Images/Thumb`
          }
          return {
            name: r.name,
            thumb,
            count: parseInt(r.count)
          }
        })

        // Top networks (from series) - get the first studio ID matching the network name
        // Joins with studios_networks table to get TMDB logo data
        const networksResult = await query<{
          id: string | null
          name: string
          count: string
          logo_path: string | null
          logo_local_path: string | null
        }>(
          `WITH network_data AS (
             SELECT DISTINCT 
               s.id as series_id,
               s.network as name,
               (SELECT studio->>'id' 
                FROM jsonb_array_elements(s.studios) AS studio 
                WHERE studio->>'name' = s.network 
                LIMIT 1) as network_id
             FROM watch_history wh
             JOIN episodes e ON e.id = wh.episode_id
             JOIN series s ON s.id = e.series_id
             WHERE wh.user_id = $1
               AND wh.episode_id IS NOT NULL
               AND ${WATCHED}
               AND s.network IS NOT NULL
               AND s.network != ''
           ),
           network_counts AS (
             SELECT 
               name,
               MAX(network_id) as id,
               COUNT(DISTINCT series_id) as count
             FROM network_data
             GROUP BY name
             ORDER BY count DESC
             LIMIT 10
           )
           SELECT 
             nc.id,
             nc.name,
             nc.count,
             sn.logo_path,
             sn.logo_local_path
           FROM network_counts nc
           LEFT JOIN studios_networks sn ON sn.name = nc.name AND sn.type = 'network'
           ORDER BY nc.count DESC`,
          [id]
        )

        // Construct network image URLs - prefer local path, then TMDB, then Emby
        const topNetworks = networksResult.rows.map(r => {
          let thumb: string | null = null
          if (r.logo_local_path) {
            thumb = `/api/uploads/${r.logo_local_path}`
          } else if (r.logo_path) {
            thumb = `https://image.tmdb.org/t/p/w185${r.logo_path}`
          } else if (mediaServerBaseUrl && r.id) {
            thumb = `${mediaServerBaseUrl}/Items/${r.id}/Images/Thumb`
          }
          return {
            name: r.name,
            thumb,
            count: parseInt(r.count)
          }
        })

        // Series genre distribution for comparison
        const seriesGenreResult = await query<{ genre: string; count: string }>(
          `WITH watched_series AS (
             SELECT DISTINCT s.id, s.genres
             FROM watch_history wh
             JOIN episodes e ON e.id = wh.episode_id
             JOIN series s ON s.id = e.series_id
             WHERE wh.user_id = $1
               AND wh.episode_id IS NOT NULL
               AND ${WATCHED}
           )
           SELECT g.genre, COUNT(*) as count
           FROM watched_series ws, unnest(ws.genres) as g(genre)
           GROUP BY g.genre
           ORDER BY count DESC
           LIMIT 10`,
          [id]
        )

        const seriesGenreDistribution = seriesGenreResult.rows.map(r => ({
          genre: r.genre,
          count: parseInt(r.count)
        }))

        // Unique series watched
        const uniqueSeriesResult = await queryOne<{ count: string }>(
          `SELECT COUNT(DISTINCT e.series_id) as count
           FROM watch_history wh
           JOIN episodes e ON e.id = wh.episode_id
           WHERE wh.user_id = $1 AND wh.episode_id IS NOT NULL AND ${WATCHED}`,
          [id]
        )

        // TV watch time (minutes) — episode runtime, falling back to the
        // watched series' average episode runtime when an episode has none.
        // The old total only summed movie runtime, so TV time was missing.
        const tvTimeResult = await queryOne<{ tv_minutes: string }>(
          `WITH ep_watch AS (
             SELECT e.runtime_minutes, e.series_id
             FROM watch_history wh
             JOIN episodes e ON e.id = wh.episode_id
             WHERE wh.user_id = $1 AND wh.episode_id IS NOT NULL AND ${WATCHED}
           ),
           series_avg AS (
             SELECT series_id, AVG(runtime_minutes) AS avg_rt
             FROM episodes
             WHERE runtime_minutes IS NOT NULL
             GROUP BY series_id
           )
           SELECT COALESCE(SUM(COALESCE(ew.runtime_minutes, sa.avg_rt)), 0)::int as tv_minutes
           FROM ep_watch ew
           LEFT JOIN series_avg sa ON sa.series_id = ew.series_id`,
          [id]
        )
        const movieWatchTimeMinutes = parseInt(totalsResult?.total_runtime || '0')
        const tvWatchTimeMinutes = parseInt(tvTimeResult?.tv_minutes || '0')

        // Activity heatmap: day-of-week (0=Sun..6=Sat) x hour-of-day, across
        // both movies and episodes.
        //
        // Approximate rows are excluded here and nowhere else. A watch dated
        // by band ("last month") carries a timestamp this app chose, so its
        // hour and weekday are inventions — and this chart's entire claim is
        // about hour and weekday. It still counts as a watch everywhere that
        // asks how many or what kind.
        const heatmapResult = await query<{ dow: string; hour: string; count: string }>(
          `SELECT
             EXTRACT(DOW FROM wh.last_played_at)::int as dow,
             EXTRACT(HOUR FROM wh.last_played_at)::int as hour,
             COUNT(*) as count
           FROM watch_history wh
           WHERE wh.user_id = $1 AND wh.last_played_at IS NOT NULL
             AND wh.approximate_played_at IS NULL
           GROUP BY 1, 2`,
          [id]
        )
        const activityHeatmap = heatmapResult.rows.map(r => ({
          dow: parseInt(r.dow),
          hour: parseInt(r.hour),
          count: parseInt(r.count),
        }))

        // Taste vs. the crowd: overall average community rating of watched
        // movies, plus per-genre averages to surface "guilty pleasures".
        const avgRatingRow = await queryOne<{ avg_rating: string | null }>(
          `SELECT ROUND(AVG(m.community_rating)::numeric, 2) as avg_rating
           FROM watch_history wh
           JOIN movies m ON m.id = wh.movie_id
           LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
           WHERE wh.user_id = $1
             AND wh.movie_id IS NOT NULL
             AND ${WATCHED}
             AND m.community_rating IS NOT NULL
             AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)`,
          [id]
        )
        const avgCommunityRating = avgRatingRow?.avg_rating ? parseFloat(avgRatingRow.avg_rating) : 0

        const genreRatingResult = await query<{ genre: string; count: string; avg_rating: string }>(
          `WITH watched AS (
             SELECT m.genres, m.community_rating
             FROM watch_history wh
             JOIN movies m ON m.id = wh.movie_id
             LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
             WHERE wh.user_id = $1
               AND wh.movie_id IS NOT NULL
               AND ${WATCHED}
               AND m.community_rating IS NOT NULL
               AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)
           )
           SELECT g.genre, COUNT(*) as count, ROUND(AVG(w.community_rating)::numeric, 1) as avg_rating
           FROM watched w, unnest(w.genres) as g(genre)
           GROUP BY g.genre
           HAVING COUNT(*) >= 2
           ORDER BY count DESC`,
          [id]
        )
        // Guilty pleasures = most-watched genres whose average community
        // rating sits below your overall average.
        const guiltyPleasureGenres = genreRatingResult.rows
          .map(r => ({ genre: r.genre, count: parseInt(r.count), avgRating: parseFloat(r.avg_rating) }))
          .filter(g => avgCommunityRating > 0 && g.avgRating < avgCommunityRating)
          .slice(0, 6)

        // How far back the history reaches. Every figure below is all-time
        // except the timeline, which is a rolling twelve months, so the page
        // needs to be able to state its own coverage rather than leave the
        // reader guessing whether an empty decade means "never watched" or
        // "before we were looking".
        // Approximate dates are excluded here too, and this is the one that
        // reads worst: the caption names a month ("from your first tracked
        // play in Oct 2022"), so a backfilled title dated before a viewer's
        // real history would hand them an origin story that never happened.
        const spanRow = await queryOne<{ first_at: Date | null; last_at: Date | null }>(
          `SELECT MIN(wh.last_played_at) as first_at, MAX(wh.last_played_at) as last_at
           FROM watch_history wh
           WHERE wh.user_id = $1 AND wh.last_played_at IS NOT NULL
             AND wh.approximate_played_at IS NULL`,
          [id]
        )
        // How many watches are counted in the totals but absent from every
        // chart with a time axis. Dropping rows from a chart without saying so
        // is how a page starts quietly disagreeing with itself — the tile says
        // 243 films, the timeline plots fewer, and nothing explains the gap.
        const approximateRow = await queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM watch_history wh
            WHERE wh.user_id = $1 AND wh.approximate_played_at IS NOT NULL`,
          [id]
        )
        const approximateWatches = parseInt(approximateRow?.count || '0', 10)

        const historySpan = {
          firstWatchedAt: spanRow?.first_at ? new Date(spanRow.first_at).toISOString() : null,
          lastWatchedAt: spanRow?.last_at ? new Date(spanRow.last_at).toISOString() : null,
        }

        // Busiest single day (movies + episodes combined)
        // Excludes approximate dates for the heatmap's reason: a band midpoint
        // is a specific day nobody named, and enough of them share one would
        // manufacture a "busiest day" out of the estimate itself.
        const busiestDayRow = await queryOne<{ date: string; count: string }>(
          `SELECT to_char(date_trunc('day', wh.last_played_at), 'YYYY-MM-DD') as date,
                  COUNT(*) as count
           FROM watch_history wh
           WHERE wh.user_id = $1 AND wh.last_played_at IS NOT NULL
             AND wh.approximate_played_at IS NULL
           GROUP BY date_trunc('day', wh.last_played_at)
           ORDER BY count DESC
           LIMIT 1`,
          [id]
        )
        const busiestDay = busiestDayRow
          ? { date: busiestDayRow.date, count: parseInt(busiestDayRow.count) }
          : null

        // Rewatch stats: movies played more than once
        const rewatchCountRow = await queryOne<{ count: string }>(
          `SELECT COUNT(*) as count
           FROM watch_history wh
           JOIN movies m ON m.id = wh.movie_id
           LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
           WHERE wh.user_id = $1
             AND wh.movie_id IS NOT NULL
             AND wh.play_count > 1
             AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)`,
          [id]
        )
        const mostRewatchedResult = await query<{
          id: string
          title: string
          poster_url: string | null
          play_count: string
        }>(
          `SELECT m.id, m.title, m.poster_url, wh.play_count
           FROM watch_history wh
           JOIN movies m ON m.id = wh.movie_id
           LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
           WHERE wh.user_id = $1
             AND wh.movie_id IS NOT NULL
             AND wh.play_count > 1
             AND (NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)
           ORDER BY wh.play_count DESC, m.title ASC
           LIMIT 12`,
          [id]
        )
        const totalRewatched = parseInt(rewatchCountRow?.count || '0')
        const mostRewatched = mostRewatchedResult.rows.map(r => ({
          movieId: r.id,
          title: r.title,
          poster: r.poster_url,
          playCount: parseInt(r.play_count),
        }))

        return reply.send({
          genreDistribution,
          watchTimeline,
          decadeDistribution,
          ratingDistribution,
          totalMovies: parseInt(totalsResult?.total_movies || '0'),
          totalEpisodes: parseInt(totalsResult?.total_episodes || '0'),
          totalWatchTimeMinutes: movieWatchTimeMinutes + tvWatchTimeMinutes,
          movieWatchTimeMinutes,
          tvWatchTimeMinutes,
          totalPlays: parseInt(totalsResult?.total_plays || '0'),
          totalFavorites: parseInt(totalsResult?.favorites || '0'),
          totalSeries: parseInt(uniqueSeriesResult?.count || '0'),
          topActors,
          topDirectors,
          topStudios,
          topNetworks,
          seriesGenreDistribution,
          activityHeatmap,
          avgCommunityRating,
          guiltyPleasureGenres,
          busiestDay,
          historySpan,
          approximateWatches,
          totalRewatched,
          mostRewatched
        })
      } catch (error) {
        fastify.log.error({ error, userId: id }, 'Failed to get watch stats')
        return reply.status(500).send({ error: 'Failed to get watch statistics' })
      }
    }
  )
}
