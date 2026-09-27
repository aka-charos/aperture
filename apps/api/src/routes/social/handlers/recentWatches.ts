/**
 * What the caller's connections watched lately — one dashboard slider each.
 *
 * Lives here rather than in core because the watched predicate it uses,
 * `WATCHED_SQL` (played, replayed or resumed; bookmarks excluded), is the API's
 * own — the same reading the viewer's own Recent Watches list uses — and core
 * cannot import from the API app. Imported, never restated.
 *
 * Three rules.
 *
 * 1. **The CALLER's scope, on both kinds.** A poster from a library the viewer
 *    cannot open would answer "not found" when clicked. The scope already
 *    intersects the operator's library switch (F-136 rule 2), so
 *    `LIBRARY_ENABLED_SQL` is not needed on top.
 * 2. **The per-person limit is applied in SQL** with window functions, never by
 *    fetching whole histories and slicing — a connection can have thousands of
 *    rows. `idx_watch_history_last_played (user_id, last_played_at DESC)` serves
 *    it.
 * 3. **Ordered by date, a date is never printed.** Approximate (backdated)
 *    plays (F-108) are included exactly as the viewer's own recent list
 *    includes them; if a date is ever shown here, apply F-108's time-axis rule
 *    first.
 */
import type { FastifyInstance } from 'fastify'
import { listVisibleConnections, visibleConnectionsSql } from '@aperture/core'
import { query } from '../../../lib/db.js'
import { scopeClause, viewerScope } from '../../../lib/viewerScope.js'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'
import { WATCHED_SQL } from '../../users/handlers/profile/watchStatsFilters.js'
import { recentWatchesSchema } from '../schemas.js'

/** The dashboard's own recent-watch shape, plus `genres` (MediaCarousel requires it). */
interface RecentWatchItem {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  lastWatched: string
  playCount: number
  lastEpisode?: { seasonNumber: number; episodeNumber: number }
}

interface MovieRow {
  user_id: string
  id: string
  title: string
  year: number | null
  poster_url: string | null
  genres: string[] | null
  last_played_at: Date
  play_count: number | null
}

interface SeriesRow extends MovieRow {
  season_number: number | null
  episode_number: number | null
}

export function registerRecentWatchesHandler(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { limitPerUser?: number } }>(
    '/api/social/recent-watches',
    { preHandler: requireAuth, schema: recentWatchesSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const limit = Math.min(Math.max(Number(request.query.limitPerUser) || 15, 1), 50)

      try {
        const connections = await listVisibleConnections(currentUser.id)
        if (connections.length === 0) return reply.send({ users: [] })

        const scope = await viewerScope(request)

        const movieParams: unknown[] = [currentUser.id]
        const movieScope = scopeClause(scope, 'm', movieParams)
        movieParams.push(limit)
        const movieLimit = `$${movieParams.length}`

        const seriesParams: unknown[] = [currentUser.id]
        const seriesScope = scopeClause(scope, 's', seriesParams)
        seriesParams.push(limit)
        const seriesLimit = `$${seriesParams.length}`

        const [movies, series] = await Promise.all([
          query<MovieRow>(
            `WITH ranked AS (
               SELECT wh.user_id, m.id, m.title, m.year, m.poster_url, m.genres,
                      wh.last_played_at, wh.play_count,
                      ROW_NUMBER() OVER (PARTITION BY wh.user_id ORDER BY wh.last_played_at DESC) AS rn
                 FROM watch_history wh
                 JOIN movies m ON m.id = wh.movie_id
                WHERE wh.user_id IN (${visibleConnectionsSql('$1::uuid')})
                  AND wh.movie_id IS NOT NULL AND wh.last_played_at IS NOT NULL
                  AND ${WATCHED_SQL}
                  AND ${movieScope}
             )
             SELECT * FROM ranked WHERE rn <= ${movieLimit}`,
            movieParams
          ),
          // Latest episode per (person, series), then the newest series per person.
          query<SeriesRow>(
            `WITH per_series AS (
               SELECT wh.user_id, s.id, s.title, s.year, s.poster_url, s.genres,
                      wh.last_played_at, wh.play_count, e.season_number, e.episode_number,
                      ROW_NUMBER() OVER (PARTITION BY wh.user_id, s.id ORDER BY wh.last_played_at DESC) AS rn
                 FROM watch_history wh
                 JOIN episodes e ON e.id = wh.episode_id
                 JOIN series s ON s.id = e.series_id
                WHERE wh.user_id IN (${visibleConnectionsSql('$1::uuid')})
                  AND wh.episode_id IS NOT NULL AND wh.last_played_at IS NOT NULL
                  AND ${WATCHED_SQL}
                  AND ${seriesScope}
             ), latest AS (
               SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY last_played_at DESC) AS urn
                 FROM per_series WHERE rn = 1
             )
             SELECT * FROM latest WHERE urn <= ${seriesLimit}`,
            seriesParams
          ),
        ])

        const byUser = new Map<string, RecentWatchItem[]>()
        const add = (userId: string, item: RecentWatchItem) => {
          const list = byUser.get(userId)
          if (list) list.push(item)
          else byUser.set(userId, [item])
        }

        for (const r of movies.rows) {
          add(r.user_id, {
            id: r.id,
            type: 'movie',
            title: r.title,
            year: r.year ?? null,
            posterUrl: r.poster_url,
            genres: r.genres ?? [],
            lastWatched: r.last_played_at.toISOString(),
            playCount: r.play_count ?? 0,
          })
        }
        for (const r of series.rows) {
          add(r.user_id, {
            id: r.id,
            type: 'series',
            title: r.title,
            year: r.year ?? null,
            posterUrl: r.poster_url,
            genres: r.genres ?? [],
            lastWatched: r.last_played_at.toISOString(),
            playCount: r.play_count ?? 0,
            ...(r.season_number != null && r.episode_number != null
              ? { lastEpisode: { seasonNumber: r.season_number, episodeNumber: r.episode_number } }
              : {}),
          })
        }

        // One entry per connection, in name order, kept even when empty — the
        // client decides whether an empty slider is worth a row.
        const users = connections.map((c) => ({
          user: { id: c.id, name: c.name, avatarUrl: c.avatarUrl },
          items: (byUser.get(c.id) ?? [])
            .sort((a, b) => b.lastWatched.localeCompare(a.lastWatched))
            .slice(0, limit),
        }))

        return reply.send({ users })
      } catch (err) {
        request.log.error({ err, userId: currentUser.id }, 'Failed to load connections’ recent watches')
        return reply.status(500).send({ error: 'Failed to load recent watches' })
      }
    }
  )
}
