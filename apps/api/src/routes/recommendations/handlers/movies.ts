/**
 * Movie Recommendations Handlers
 */

import type { FastifyInstance } from 'fastify'
import { query, queryOne } from '../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'
import {
  regenerateUserRecommendations,
  getEffectiveAiExplanationSetting,
  refreshExplanations,
  type ExplanationMediaType,
} from '@aperture/core'
import { recommendationSchemas } from '../schemas.js'
import { resolveTwinShared } from '../../../lib/twinShared.js'
import type { MovieRecommendationCandidate, RecommendationRun } from '../types.js'

export async function registerMovieHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/recommendations/:userId
   * Get user's latest movie recommendations
   */
  fastify.get<{ Params: { userId: string }; Querystring: { runId?: string } }>(
    '/api/recommendations/:userId',
    { preHandler: requireAuth, schema: recommendationSchemas.getMovieRecommendations },
    async (request, reply) => {
      const { userId } = request.params
      const { runId } = request.query
      const currentUser = request.user as SessionUser

      if (userId !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      let run: RecommendationRun | null

      if (runId) {
        run = await queryOne<RecommendationRun>(
          `SELECT * FROM recommendation_runs WHERE id = $1 AND user_id = $2`,
          [runId, userId]
        )
      } else {
        run = await queryOne<RecommendationRun>(
          `SELECT * FROM recommendation_runs
           WHERE user_id = $1 AND status = 'completed' AND media_type = 'movie'
           ORDER BY created_at DESC
           LIMIT 1`,
          [userId]
        )
      }

      if (!run) {
        return reply.send({
          run: null,
          recommendations: [],
          message: 'No recommendations found',
        })
      }

      const candidates = await query<MovieRecommendationCandidate>(
        `SELECT rc.*,
                json_build_object(
                  'id', m.id,
                  'title', m.title,
                  'year', m.year,
                  'poster_url', m.poster_url,
                  'genres', m.genres,
                  'community_rating', m.community_rating,
                  'overview', m.overview,
                  'runtime_minutes', m.runtime_minutes,
                  'tmdb_id', m.tmdb_id
                ) as movie
         FROM recommendation_candidates rc
         JOIN movies m ON m.id = rc.movie_id
         LEFT JOIN library_config lc ON lc.provider_library_id = m.provider_library_id
         WHERE rc.run_id = $1 
           AND rc.is_selected = true
           AND rc.movie_id IS NOT NULL
           AND (
             NOT EXISTS (SELECT 1 FROM library_config WHERE collection_type = 'movies')
             OR lc.is_enabled = true
             OR m.provider_library_id IS NULL
           )
         ORDER BY rc.selected_rank ASC NULLS LAST`,
        [run.id]
      )

      return reply.send({
        run,
        recommendations: candidates.rows,
      })
    }
  )

  /**
   * POST /api/recommendations/:userId/regenerate
   * Regenerate movie recommendations for a user
   */
  fastify.post<{ Params: { userId: string } }>(
    '/api/recommendations/:userId/regenerate',
    { preHandler: requireAuth, schema: recommendationSchemas.regenerateMovieRecommendations },
    async (request, reply) => {
      const { userId } = request.params
      const currentUser = request.user as SessionUser

      if (userId !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      try {
        const result = await regenerateUserRecommendations(userId)
        return reply.send({
          message: 'Recommendations regenerated successfully',
          runId: result.runId,
          count: result.count,
        })
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        fastify.log.error({ err, userId }, 'Failed to regenerate recommendations')
        return reply.status(500).send({ error: `Failed to regenerate: ${error}` })
      }
    }
  )

  /**
   * POST /api/recommendations/:userId/explanations
   *
   * Rewrite the AI explanations on the user's current recommendations without
   * re-scoring. Lives on the movie handler but covers both media types, the
   * same way the job does — the explanation pass is not media-specific, and
   * splitting it in two would mean two round trips to change one setting's
   * output.
   */
  fastify.post<{ Params: { userId: string }; Body: { mediaType?: ExplanationMediaType } }>(
    '/api/recommendations/:userId/explanations',
    { preHandler: requireAuth, schema: recommendationSchemas.refreshExplanations },
    async (request, reply) => {
      const { userId } = request.params
      const currentUser = request.user as SessionUser

      if (userId !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      const mediaType = request.body?.mediaType

      try {
        const result = await refreshExplanations({
          userId,
          mediaTypes: mediaType ? [mediaType] : undefined,
        })
        return reply.send({
          message: 'Explanations refreshed',
          runs: result.runs,
          explanations: result.explanations,
          skipped: result.skipped,
          failed: result.failed,
        })
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        fastify.log.error({ err, userId }, 'Failed to refresh explanations')
        return reply.status(500).send({ error: `Failed to refresh explanations: ${error}` })
      }
    }
  )

  /**
   * GET /api/recommendations/:userId/movie/:movieId/insights
   * Get detailed AI recommendation insights for a specific movie
   */
  fastify.get<{ Params: { userId: string; movieId: string } }>(
    '/api/recommendations/:userId/movie/:movieId/insights',
    { preHandler: requireAuth, schema: recommendationSchemas.getMovieInsights },
    async (request, reply) => {
      const { userId, movieId } = request.params
      const currentUser = request.user as SessionUser

      if (userId !== currentUser.id && !currentUser.isAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      // candidate_count is how large a pool this run scored, which is the
      // denominator that makes a rank mean anything ("#340 of 12,451"). Read
      // from the run rather than counted here: the pipeline already recorded
      // what it scored, and that stays true after old runs are thinned.
      const latestRun = await queryOne<{ id: string; candidate_count: number }>(
        `SELECT id, candidate_count FROM recommendation_runs
         WHERE user_id = $1 AND status = 'completed' AND media_type = 'movie'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      )

      if (!latestRun) {
        return reply.send({
          isRecommended: false,
          message: 'No recommendations generated yet',
        })
      }

      const candidate = await queryOne<{
        id: string
        rank: number
        is_selected: boolean
        final_score: number
        similarity_score: number | null
        novelty_score: number | null
        rating_score: number | null
        diversity_score: number | null
        score_breakdown: Record<string, unknown>
        ai_explanation: string | null
      }>(
        `SELECT rc.id, rc.rank, rc.is_selected, rc.final_score,
                rc.similarity_score, rc.novelty_score, rc.rating_score, rc.diversity_score,
                rc.score_breakdown, rc.ai_explanation
         FROM recommendation_candidates rc
         WHERE rc.run_id = $1 AND rc.movie_id = $2`,
        [latestRun.id, movieId]
      )

      if (!candidate) {
        return reply.send({
          isRecommended: false,
          message: 'This movie was not considered in your recommendations',
        })
      }

      const evidence = await query<{
        id: string
        similar_movie_id: string
        similarity: number
        evidence_type: string
        similar_movie: {
          id: string
          title: string
          year: number | null
          poster_url: string | null
          genres: string[]
        }
      }>(
        `SELECT re.id, re.similar_movie_id, re.similarity, re.evidence_type,
                json_build_object(
                  'id', m.id,
                  'title', m.title,
                  'year', m.year,
                  'poster_url', m.poster_url,
                  'genres', m.genres
                ) as similar_movie
         FROM recommendation_evidence re
         JOIN movies m ON m.id = re.similar_movie_id
         WHERE re.candidate_id = $1
         ORDER BY re.similarity DESC
         LIMIT 10`,
        [candidate.id]
      )

      // The titles that earned the taste-twin relationship, when a reserved
      // twin slot is what put this film in the list.
      //
      // Distinct from `evidence` above in the way that matters: evidence is a
      // content-similarity lookup run *after* the pick was made, so it explains
      // nothing about why a borrowed title is here — the ranking is precisely
      // what did not choose it. These are the rarest films the two viewers both
      // watched, which is the quantity the affinity score is built from.
      //
      // Resolved on read rather than stored as names, so a re-matched or
      // renamed film can't leave a stale title frozen in the run's JSONB.
      const twinShared = await resolveTwinShared(candidate.score_breakdown, 'movies')

      const tasteInsights = await query<{
        genre: string
        watch_count: number
      }>(
        `SELECT unnest(m.genres) as genre, COUNT(*) as watch_count
         FROM watch_history wh
         JOIN movies m ON m.id = wh.movie_id
         WHERE wh.user_id = $1
         GROUP BY unnest(m.genres)
         ORDER BY watch_count DESC
         LIMIT 10`,
        [userId]
      )

      const movie = await queryOne<{ genres: string[] }>(
        `SELECT genres FROM movies WHERE id = $1`,
        [movieId]
      )

      const userGenres = new Set(tasteInsights.rows.map((t) => t.genre))
      const movieGenres = movie?.genres || []
      const matchingGenres = movieGenres.filter((g) => userGenres.has(g))
      const newGenres = movieGenres.filter((g) => !userGenres.has(g))

      // Withheld unless the target user's effective setting allows it, so the
      // toggle governs this surface the same way it governs the NFO plot. Note
      // it is the target's setting, not the viewing admin's.
      const aiExplanation = (await getEffectiveAiExplanationSetting(userId))
        ? candidate.ai_explanation
        : null

      return reply.send({
        isRecommended: true,
        aiExplanation,
        isSelected: candidate.is_selected,
        rank: candidate.rank,
        totalCandidates: latestRun.candidate_count,
        scores: {
          final: Number(candidate.final_score),
          // Explicit null checks, not truthiness: these columns are NUMERIC and
          // pg hands them back as strings, so a stored 0 arrives as '0.0000'
          // and passes a truthy test. That is how a candidate the diversity
          // selector never looked at came to render a confident "Variety 0%".
          similarity: candidate.similarity_score != null ? Number(candidate.similarity_score) : null,
          novelty: candidate.novelty_score != null ? Number(candidate.novelty_score) : null,
          rating: candidate.rating_score != null ? Number(candidate.rating_score) : null,
          diversity: candidate.diversity_score != null ? Number(candidate.diversity_score) : null,
        },
        scoreBreakdown: candidate.score_breakdown,
        twinShared,
        evidence: evidence.rows,
        genreAnalysis: {
          movieGenres,
          matchingGenres,
          newGenres,
          userTopGenres: tasteInsights.rows.slice(0, 5),
        },
      })
    }
  )
}
