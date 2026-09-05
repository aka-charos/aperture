import type { FastifyInstance } from 'fastify'
import { query } from '../../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../../plugins/auth.js'
import { requireSelfOrAdmin } from './shared.js'
import { WATCHED_SQL, LIBRARY_ENABLED_SQL } from './watchStatsFilters.js'

/**
 * Drill-in behind every number on the Watch Stats page.
 *
 * Each chart bucket ("Cate Blanchett — 7 films", "1990s", "Netflix") resolves
 * to a predicate over the same watched-history population the summary counted,
 * so the list a bucket opens is the population that produced its number.
 */

type Dimension =
  | 'genre'
  | 'seriesGenre'
  | 'decade'
  | 'rating'
  | 'actor'
  | 'director'
  | 'studio'
  | 'network'
  | 'month'
  | 'day'
  | 'timeOfDay'
  | 'movies'
  | 'series'
  | 'favorites'
  | 'rewatched'

interface Resolved {
  /** Predicate over `wh`/`m`, or null when this dimension has no movie side. */
  movieWhere: string | null
  /** Predicate over `wh`/`s`, or null when this dimension has no series side. */
  seriesWhere: string | null
  /** Extra bound parameters after `$1` (the user id). */
  params: (string | number)[]
  /**
   * Favorites and rewatches are counted without the watched predicate on the
   * summary cards, so the drill-in has to relax it too or the list comes back
   * shorter than the number that opened it.
   */
  skipWatched?: boolean
}

/**
 * Maps a bucket to SQL. Returns null for an unknown dimension or a value the
 * dimension cannot parse, which the route answers as a 400 — a silently empty
 * list would read as "you watched nothing here".
 */
function resolve(dimension: string, value: string, value2: string): Resolved | null {
  switch (dimension as Dimension) {
    case 'genre':
      return { movieWhere: '$2 = ANY(m.genres)', seriesWhere: null, params: [value] }
    case 'seriesGenre':
      return { movieWhere: null, seriesWhere: '$2 = ANY(s.genres)', params: [value] }
    case 'decade': {
      // Labels arrive as "1990s"; the chart writes them, so the trailing
      // marker is stripped rather than parsed.
      const decade = Number.parseInt(value.replace(/\D+$/, ''), 10)
      if (!Number.isFinite(decade)) return null
      return {
        movieWhere: 'FLOOR(m.year / 10) * 10 = $2::int',
        seriesWhere: null,
        params: [decade],
      }
    }
    case 'rating': {
      const rating = Number.parseFloat(value)
      if (!Number.isFinite(rating)) return null
      return {
        movieWhere: 'ROUND(m.community_rating * 2) / 2 = $2::numeric',
        seriesWhere: null,
        params: [rating],
      }
    }
    case 'actor':
      return {
        movieWhere:
          "EXISTS (SELECT 1 FROM jsonb_array_elements(m.actors) a WHERE a->>'name' = $2)",
        seriesWhere: null,
        params: [value],
      }
    case 'director':
      return { movieWhere: '$2 = ANY(m.directors)', seriesWhere: null, params: [value] }
    case 'studio':
      return {
        movieWhere:
          "EXISTS (SELECT 1 FROM jsonb_array_elements(m.studios) st WHERE st->>'name' = $2)",
        seriesWhere: null,
        params: [value],
      }
    case 'network':
      return { movieWhere: null, seriesWhere: 's.network = $2', params: [value] }
    case 'month': {
      // The chart labels months "Mon YYYY" for the reader; the drill-in takes
      // the unambiguous form so it never has to parse a localized month name.
      if (!/^\d{4}-\d{2}$/.test(value)) return null
      const clause =
        "to_char(wh.last_played_at, 'YYYY-MM') = $2 AND wh.approximate_played_at IS NULL"
      return { movieWhere: clause, seriesWhere: clause, params: [value] }
    }
    // The dimensions whose summary excludes approximate dates must exclude
    // them here too. The chip and the list it opens have to be filtering on the
    // same population — a "7 films" badge that opens five is a bug report — and
    // these are the charts a band-dated watch is deliberately absent from.
    case 'day': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
      const clause =
        "to_char(wh.last_played_at, 'YYYY-MM-DD') = $2 AND wh.approximate_played_at IS NULL"
      return { movieWhere: clause, seriesWhere: clause, params: [value] }
    }
    case 'timeOfDay': {
      const dow = Number.parseInt(value, 10)
      const hour = Number.parseInt(value2, 10)
      if (!Number.isFinite(dow) || !Number.isFinite(hour)) return null
      const clause =
        'EXTRACT(DOW FROM wh.last_played_at)::int = $2::int' +
        ' AND EXTRACT(HOUR FROM wh.last_played_at)::int = $3::int' +
        ' AND wh.approximate_played_at IS NULL'
      return { movieWhere: clause, seriesWhere: clause, params: [dow, hour] }
    }
    case 'movies':
      return { movieWhere: 'TRUE', seriesWhere: null, params: [] }
    case 'series':
      return { movieWhere: null, seriesWhere: 'TRUE', params: [] }
    case 'favorites':
      return {
        movieWhere: 'wh.is_favorite = true',
        seriesWhere: null,
        params: [],
        skipWatched: true,
      }
    case 'rewatched':
      return { movieWhere: 'wh.play_count > 1', seriesWhere: null, params: [], skipWatched: true }
    default:
      return null
  }
}

interface BreakdownItem {
  id: string
  mediaType: 'movie' | 'series'
  title: string
  year: number | null
  poster: string | null
  rating: number | null
  playCount: number | null
  episodesWatched: number | null
  lastPlayedAt: string | null
}

const DEFAULT_LIMIT = 60
const MAX_LIMIT = 200

export function registerWatchStatsBreakdownHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/users/:id/watch-stats/breakdown
   * The titles behind one bucket of the watch stats.
   */
  fastify.get<{
    Params: { id: string }
    Querystring: { dimension?: string; value?: string; value2?: string; limit?: number }
  }>(
    '/api/users/:id/watch-stats/breakdown',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['users'],
        querystring: {
          type: 'object',
          required: ['dimension'],
          properties: {
            dimension: { type: 'string' },
            value: { type: 'string' },
            value2: { type: 'string' },
            // Declared so Fastify coerces it — a string would interpolate
            // into the LIMIT as text.
            limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const currentUser = request.user as SessionUser

      if (!requireSelfOrAdmin(id, currentUser, reply)) return

      const { dimension = '', value = '', value2 = '' } = request.query
      const limit = Math.min(request.query.limit || DEFAULT_LIMIT, MAX_LIMIT)

      const spec = resolve(dimension, value, value2)
      if (!spec) {
        return reply.status(400).send({ error: 'Unknown or unparseable breakdown dimension' })
      }

      const watched = spec.skipWatched ? 'TRUE' : WATCHED_SQL

      try {
        const items: BreakdownItem[] = []
        let total = 0

        if (spec.movieWhere) {
          const movieRows = await query<{
            id: string
            title: string
            year: number | null
            poster_url: string | null
            community_rating: string | null
            play_count: number | null
            last_played_at: Date | null
            total: string
          }>(
            `SELECT m.id, m.title, m.year, m.poster_url, m.community_rating,
                    wh.play_count, wh.last_played_at,
                    COUNT(*) OVER() as total
             FROM watch_history wh
             JOIN movies m ON m.id = wh.movie_id
             LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
             WHERE wh.user_id = $1
               AND wh.movie_id IS NOT NULL
               AND ${watched}
               AND ${LIBRARY_ENABLED_SQL}
               AND ${spec.movieWhere}
             ORDER BY wh.last_played_at DESC NULLS LAST, m.title ASC
             LIMIT ${limit}`,
            [id, ...spec.params]
          )

          if (movieRows.rows.length > 0) total += parseInt(movieRows.rows[0].total, 10)
          for (const r of movieRows.rows) {
            items.push({
              id: r.id,
              mediaType: 'movie',
              title: r.title,
              year: r.year,
              poster: r.poster_url,
              // NUMERIC arrives as text, so a stored 0 passes a truthy test
              // while a real 0 fails one — read the null explicitly.
              rating: r.community_rating != null ? parseFloat(r.community_rating) : null,
              playCount: r.play_count ?? null,
              episodesWatched: null,
              lastPlayedAt: r.last_played_at ? new Date(r.last_played_at).toISOString() : null,
            })
          }
        }

        if (spec.seriesWhere) {
          const seriesRows = await query<{
            id: string
            title: string
            year: number | null
            poster_url: string | null
            community_rating: string | null
            episodes_watched: string
            last_played_at: Date | null
            total: string
          }>(
            `SELECT s.id, s.title, s.year, s.poster_url, s.community_rating,
                    COUNT(*) as episodes_watched,
                    MAX(wh.last_played_at) as last_played_at,
                    COUNT(*) OVER() as total
             FROM watch_history wh
             JOIN episodes e ON e.id = wh.episode_id
             JOIN series s ON s.id = e.series_id
             WHERE wh.user_id = $1
               AND wh.episode_id IS NOT NULL
               AND ${watched}
               AND ${spec.seriesWhere}
             GROUP BY s.id, s.title, s.year, s.poster_url, s.community_rating
             ORDER BY MAX(wh.last_played_at) DESC NULLS LAST, s.title ASC
             LIMIT ${limit}`,
            [id, ...spec.params]
          )

          if (seriesRows.rows.length > 0) total += parseInt(seriesRows.rows[0].total, 10)
          for (const r of seriesRows.rows) {
            items.push({
              id: r.id,
              mediaType: 'series',
              title: r.title,
              year: r.year,
              poster: r.poster_url,
              rating: r.community_rating != null ? parseFloat(r.community_rating) : null,
              playCount: null,
              episodesWatched: parseInt(r.episodes_watched, 10),
              lastPlayedAt: r.last_played_at ? new Date(r.last_played_at).toISOString() : null,
            })
          }
        }

        // A dimension with both sides appends series after movies; interleave
        // by recency so the list reads as one stretch of watching rather than
        // two blocks.
        if (spec.movieWhere && spec.seriesWhere) {
          items.sort((a, b) => (b.lastPlayedAt || '').localeCompare(a.lastPlayedAt || ''))
        }

        return reply.send({ dimension, value, total, items: items.slice(0, limit) })
      } catch (error) {
        fastify.log.error({ error, userId: id, dimension }, 'Failed to get watch stats breakdown')
        return reply.status(500).send({ error: 'Failed to get watch statistics breakdown' })
      }
    }
  )
}
