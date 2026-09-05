import type { FastifyPluginAsync } from 'fastify'
import { query, queryOne } from '../../lib/db.js'
import { requireAuth, type SessionUser } from '../../plugins/auth.js'
import {
  pushRatingToTrakt,
  removeRatingFromTrakt,
  getUserTraktStatus,
  availableWatchDateBands,
  type WatchDateBand,
} from '@aperture/core'

import {
  ratingsSchemas,
  getRatingsSchema,
  getDislikedSchema,
  getMovieRatingSchema,
  getSeriesRatingSchema,
  rateMovieSchema,
  rateSeriesSchema,
  deleteMovieRatingSchema,
  notWatchedSchema,
  deleteSeriesRatingSchema,
  bulkRatingsSchema,
} from './schemas.js'

/**
 * Whether to ask a viewer when they watched a title they have just rated.
 *
 * The prompt exists because a rating on something the media server says was
 * never played is ambiguous — most often they did watch it, elsewhere or long
 * ago, and nothing recorded it. It is offered only when there is something to
 * record and a way to record it, and the bands are decided here rather than in
 * the bundle because the web never imports core.
 */
interface WatchDatePrompt {
  title: string
  /** Newest first. One entry means the question degenerates to a yes/no. */
  bands: WatchDateBand[]
}

async function buildWatchDatePrompt(
  user: SessionUser,
  movieId: string
): Promise<WatchDatePrompt | null> {
  // Marking played writes to the media server, so someone who may not do that
  // is never offered it; the write would 403 anyway.
  if (!user.isAdmin && !user.canManageWatchHistory) return null

  const row = await queryOne<{
    title: string
    premiere_date: Date | null
    already_watched: boolean
    declared_not_watched: boolean
  }>(
    `SELECT
       m.title,
       m.premiere_date,
       EXISTS (
         SELECT 1 FROM watch_history wh
         WHERE wh.user_id = $1 AND wh.movie_id = m.id
           AND (wh.played = true OR wh.play_count > 0
                OR COALESCE(wh.playback_position_ticks, 0) > 0)
       ) AS already_watched,
       EXISTS (
         SELECT 1 FROM user_ratings ur
         WHERE ur.user_id = $1 AND ur.movie_id = m.id
           AND ur.not_watched_declared_at IS NOT NULL
       ) AS declared_not_watched
     FROM movies m
     WHERE m.id = $2`,
    [user.id, movieId]
  )

  if (!row) return null
  // Already played, or they have said outright they have not seen it. The
  // second is the whole reason that column exists: without it the batch
  // prompt would ask the same person about the same film forever.
  if (row.already_watched || row.declared_not_watched) return null

  const bands = availableWatchDateBands(new Date(), row.premiere_date ?? null)
  // A title whose release date is still ahead of us has no band anyone could
  // truthfully pick, so there is no question to ask.
  if (bands.length === 0) return null

  return { title: row.title, bands }
}

interface UserRating {
  id: string
  movie_id: string | null
  series_id: string | null
  rating: number
  source: string
  created_at: Date
  updated_at: Date
  // Joined fields
  title?: string
  year?: number | null
  poster_url?: string | null
}

interface RatingsListResponse {
  ratings: UserRating[]
  movies: UserRating[]
  series: UserRating[]
}

const ratingsRoutes: FastifyPluginAsync = async (fastify) => {
  // Register schemas
  for (const [name, schema] of Object.entries(ratingsSchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  /**
   * GET /api/ratings
   * Get all ratings for the current user
   */
  fastify.get<{ Reply: RatingsListResponse }>(
    '/api/ratings',
    { preHandler: requireAuth, schema: getRatingsSchema },
    async (request, reply) => {
      const user = request.user as SessionUser

      // Get movie ratings with movie info
      const movieRatings = await query<UserRating>(
        `SELECT ur.id, ur.movie_id, ur.series_id, ur.rating, ur.source, ur.created_at, ur.updated_at,
                m.title, m.year, m.poster_url
         FROM user_ratings ur
         JOIN movies m ON m.id = ur.movie_id
         WHERE ur.user_id = $1 AND ur.movie_id IS NOT NULL
         ORDER BY ur.updated_at DESC`,
        [user.id]
      )

      // Get series ratings with series info
      const seriesRatings = await query<UserRating>(
        `SELECT ur.id, ur.movie_id, ur.series_id, ur.rating, ur.source, ur.created_at, ur.updated_at,
                s.title, s.year, s.poster_url
         FROM user_ratings ur
         JOIN series s ON s.id = ur.series_id
         WHERE ur.user_id = $1 AND ur.series_id IS NOT NULL
         ORDER BY ur.updated_at DESC`,
        [user.id]
      )

      return reply.send({
        ratings: [...movieRatings.rows, ...seriesRatings.rows],
        movies: movieRatings.rows,
        series: seriesRatings.rows,
      })
    }
  )

  /**
   * GET /api/ratings/disliked
   * Get all disliked items (rating <= 3) for the current user
   */
  fastify.get<{
    Querystring: { type?: 'movie' | 'series' | 'all' }
    Reply: {
      movies: Array<{
        id: string
        title: string
        year: number | null
        posterUrl: string | null
        rating: number
      }>
      series: Array<{
        id: string
        title: string
        year: number | null
        posterUrl: string | null
        rating: number
      }>
      totalCount: number
    }
  }>(
    '/api/ratings/disliked',
    { preHandler: requireAuth, schema: getDislikedSchema },
    async (request, reply) => {
      const user = request.user as SessionUser
      const type = request.query.type || 'all'

      const movies: Array<{
        id: string
        title: string
        year: number | null
        posterUrl: string | null
        rating: number
      }> = []

      const series: Array<{
        id: string
        title: string
        year: number | null
        posterUrl: string | null
        rating: number
      }> = []

      if (type === 'all' || type === 'movie') {
        // Get disliked movies (rating 1-3)
        const movieResult = await query<{
          movie_id: string
          rating: number
          title: string
          year: number | null
          poster_url: string | null
        }>(
          `SELECT ur.movie_id, ur.rating, m.title, m.year, m.poster_url
           FROM user_ratings ur
           JOIN movies m ON m.id = ur.movie_id
           WHERE ur.user_id = $1 AND ur.movie_id IS NOT NULL AND ur.rating <= 3
           ORDER BY m.title ASC`,
          [user.id]
        )

        for (const row of movieResult.rows) {
          movies.push({
            id: row.movie_id,
            title: row.title,
            year: row.year,
            posterUrl: row.poster_url,
            rating: row.rating,
          })
        }
      }

      if (type === 'all' || type === 'series') {
        // Get disliked series (rating 1-3)
        const seriesResult = await query<{
          series_id: string
          rating: number
          title: string
          year: number | null
          poster_url: string | null
        }>(
          `SELECT ur.series_id, ur.rating, s.title, s.year, s.poster_url
           FROM user_ratings ur
           JOIN series s ON s.id = ur.series_id
           WHERE ur.user_id = $1 AND ur.series_id IS NOT NULL AND ur.rating <= 3
           ORDER BY s.title ASC`,
          [user.id]
        )

        for (const row of seriesResult.rows) {
          series.push({
            id: row.series_id,
            title: row.title,
            year: row.year,
            posterUrl: row.poster_url,
            rating: row.rating,
          })
        }
      }

      return reply.send({
        movies,
        series,
        totalCount: movies.length + series.length,
      })
    }
  )

  /**
   * GET /api/ratings/movie/:id
   * Get rating for a specific movie
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/ratings/movie/:id',
    { preHandler: requireAuth, schema: getMovieRatingSchema },
    async (request, reply) => {
      const user = request.user as SessionUser
      const { id } = request.params

      const rating = await queryOne<{ rating: number; source: string }>(
        `SELECT rating, source FROM user_ratings WHERE user_id = $1 AND movie_id = $2`,
        [user.id, id]
      )

      return reply.send({ rating: rating?.rating || null, source: rating?.source || null })
    }
  )

  /**
   * GET /api/ratings/series/:id
   * Get rating for a specific series
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/ratings/series/:id',
    { preHandler: requireAuth, schema: getSeriesRatingSchema },
    async (request, reply) => {
      const user = request.user as SessionUser
      const { id } = request.params

      const rating = await queryOne<{ rating: number; source: string }>(
        `SELECT rating, source FROM user_ratings WHERE user_id = $1 AND series_id = $2`,
        [user.id, id]
      )

      return reply.send({ rating: rating?.rating || null, source: rating?.source || null })
    }
  )

  /**
   * POST /api/ratings/movie/:id
   * Rate a movie (1-10)
   */
  fastify.post<{ Params: { id: string }; Body: { rating: number } }>(
    '/api/ratings/movie/:id',
    { preHandler: requireAuth, schema: rateMovieSchema },
    async (request, reply) => {
      const user = request.user as SessionUser
      const { id } = request.params
      const { rating } = request.body

      // Validate rating
      if (!rating || rating < 1 || rating > 10 || !Number.isInteger(rating)) {
        return reply.status(400).send({ error: 'Rating must be an integer between 1 and 10' })
      }

      // Check if movie exists
      const movie = await queryOne<{ id: string }>('SELECT id FROM movies WHERE id = $1', [id])
      if (!movie) {
        return reply.status(404).send({ error: 'Movie not found' })
      }

      // Upsert rating
      await query(
        `INSERT INTO user_ratings (user_id, movie_id, rating, source)
         VALUES ($1, $2, $3, 'manual')
         ON CONFLICT (user_id, movie_id) WHERE movie_id IS NOT NULL
         DO UPDATE SET rating = EXCLUDED.rating, source = 'manual', updated_at = NOW()`,
        [user.id, id, rating]
      )

      // Push to Trakt if connected (async, don't wait)
      getUserTraktStatus(user.id).then(status => {
        if (status.connected) {
          pushRatingToTrakt(user.id, { movieId: id, rating }).catch(() => {
            // Silently fail - local rating is saved, Trakt sync will catch up later
          })
        }
      })

      // Never at the cost of the rating: the rating is what the viewer asked
      // for and it is already saved, so a failure here loses a follow-up
      // question rather than their input.
      let watchPrompt: WatchDatePrompt | null = null
      try {
        watchPrompt = await buildWatchDatePrompt(user, id)
      } catch (error) {
        fastify.log.error({ error, userId: user.id, movieId: id }, 'Failed to build watch date prompt')
      }

      return reply.send({ success: true, rating, watchPrompt })
    }
  )

  /**
   * POST /api/ratings/series/:id
   * Rate a series (1-10)
   */
  fastify.post<{ Params: { id: string }; Body: { rating: number } }>(
    '/api/ratings/series/:id',
    { preHandler: requireAuth, schema: rateSeriesSchema },
    async (request, reply) => {
      const user = request.user as SessionUser
      const { id } = request.params
      const { rating } = request.body

      // Validate rating
      if (!rating || rating < 1 || rating > 10 || !Number.isInteger(rating)) {
        return reply.status(400).send({ error: 'Rating must be an integer between 1 and 10' })
      }

      // Check if series exists
      const series = await queryOne<{ id: string }>('SELECT id FROM series WHERE id = $1', [id])
      if (!series) {
        return reply.status(404).send({ error: 'Series not found' })
      }

      // Upsert rating
      await query(
        `INSERT INTO user_ratings (user_id, series_id, rating, source)
         VALUES ($1, $2, $3, 'manual')
         ON CONFLICT (user_id, series_id) WHERE series_id IS NOT NULL
         DO UPDATE SET rating = EXCLUDED.rating, source = 'manual', updated_at = NOW()`,
        [user.id, id, rating]
      )

      // Push to Trakt if connected (async, don't wait)
      getUserTraktStatus(user.id).then(status => {
        if (status.connected) {
          pushRatingToTrakt(user.id, { seriesId: id, rating }).catch(() => {
            // Silently fail - local rating is saved, Trakt sync will catch up later
          })
        }
      })

      return reply.send({ success: true, rating })
    }
  )

  /**
   * POST /api/ratings/movie/:id/not-watched
   * Record that the viewer has not seen a title they rated.
   *
   * This is the named dismissal on the watch-date prompt, and it is a real
   * answer rather than an ignore. Dismissing is ambiguous between "not now"
   * and "no", and we cannot act on an ambiguous signal: treat it as "no" and
   * someone who was merely busy is never asked again, treat it as "not now"
   * and a genuinely unwatched title is raised forever.
   *
   * It deliberately writes no watch history — there is no watch — and it does
   * not touch the rating itself. An unwatched rating is close to inert
   * already: it never reaches the taste vector, because every user_ratings
   * join in the profile builder is a LEFT JOIN from watch history.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/ratings/movie/:id/not-watched',
    { preHandler: requireAuth, schema: notWatchedSchema },
    async (request, reply) => {
      const user = request.user as SessionUser
      const { id } = request.params

      // Scoped to an existing rating: the declaration qualifies a rating, so
      // with no rating there is nothing to qualify and nowhere to put it.
      const result = await query(
        `UPDATE user_ratings
            SET not_watched_declared_at = NOW(), updated_at = NOW()
          WHERE user_id = $1 AND movie_id = $2`,
        [user.id, id]
      )
      if (!result.rowCount) {
        return reply.status(404).send({ error: 'No rating to mark' })
      }

      return reply.send({ success: true })
    }
  )
  /**
   * DELETE /api/ratings/movie/:id
   * Remove rating for a movie
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/ratings/movie/:id',
    { preHandler: requireAuth, schema: deleteMovieRatingSchema },
    async (request, reply) => {
      const user = request.user as SessionUser
      const { id } = request.params

      await query(
        `DELETE FROM user_ratings WHERE user_id = $1 AND movie_id = $2`,
        [user.id, id]
      )

      // Remove from Trakt if connected (async, don't wait)
      getUserTraktStatus(user.id).then(status => {
        if (status.connected) {
          removeRatingFromTrakt(user.id, { movieId: id }).catch(() => {})
        }
      })

      return reply.send({ success: true })
    }
  )

  /**
   * DELETE /api/ratings/series/:id
   * Remove rating for a series
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/ratings/series/:id',
    { preHandler: requireAuth, schema: deleteSeriesRatingSchema },
    async (request, reply) => {
      const user = request.user as SessionUser
      const { id } = request.params

      await query(
        `DELETE FROM user_ratings WHERE user_id = $1 AND series_id = $2`,
        [user.id, id]
      )

      // Remove from Trakt if connected (async, don't wait)
      getUserTraktStatus(user.id).then(status => {
        if (status.connected) {
          removeRatingFromTrakt(user.id, { seriesId: id }).catch(() => {})
        }
      })

      return reply.send({ success: true })
    }
  )

  /**
   * POST /api/ratings/bulk
   * Bulk upsert ratings (used by Trakt sync)
   */
  fastify.post<{
    Body: {
      ratings: Array<{
        movieId?: string
        seriesId?: string
        rating: number
        source?: string
      }>
    }
  }>(
    '/api/ratings/bulk',
    { preHandler: requireAuth, schema: bulkRatingsSchema },
    async (request, reply) => {
      const user = request.user as SessionUser
      const { ratings } = request.body

      if (!Array.isArray(ratings)) {
        return reply.status(400).send({ error: 'ratings must be an array' })
      }

      let inserted = 0
      let updated = 0
      let skipped = 0

      for (const r of ratings) {
        // Validate
        if (!r.rating || r.rating < 1 || r.rating > 10) {
          skipped++
          continue
        }

        if (r.movieId) {
          const result = await query(
            `INSERT INTO user_ratings (user_id, movie_id, rating, source)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, movie_id) WHERE movie_id IS NOT NULL
             DO UPDATE SET rating = EXCLUDED.rating, source = EXCLUDED.source, updated_at = NOW()
             RETURNING (xmax = 0) as is_insert`,
            [user.id, r.movieId, r.rating, r.source || 'trakt']
          )
          if (result.rows[0]?.is_insert) {
            inserted++
          } else {
            updated++
          }
        } else if (r.seriesId) {
          const result = await query(
            `INSERT INTO user_ratings (user_id, series_id, rating, source)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, series_id) WHERE series_id IS NOT NULL
             DO UPDATE SET rating = EXCLUDED.rating, source = EXCLUDED.source, updated_at = NOW()
             RETURNING (xmax = 0) as is_insert`,
            [user.id, r.seriesId, r.rating, r.source || 'trakt']
          )
          if (result.rows[0]?.is_insert) {
            inserted++
          } else {
            updated++
          }
        } else {
          skipped++
        }
      }

      return reply.send({ success: true, inserted, updated, skipped })
    }
  )
}

export default ratingsRoutes
