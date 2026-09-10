/**
 * Recommendation tools with Tool UI output schemas
 */
import { tool } from 'ai'
import { nullSafe } from './utils.js'
import { z } from 'zod'
import { query } from '../../../lib/db.js'
import { readTwinSharedIds, resolveTwinSharedTitles } from '../../../lib/twinShared.js'
import { enrichCardReasons } from '../discovery/enrichReasons.js'
import { buildPlayLink } from '../helpers/mediaServer.js'
import { formatContentItem, pickSource, searchScoredPool } from './scoredPool.js'
import type { ContentItem } from '../schemas/index.js'
import type { ToolContext, MovieResult, SeriesResult } from '../types.js'
import { WATCH_HISTORY_PLAYED_SQL } from '@aperture/core'


export function createRecommendationTools(ctx: ToolContext) {
  return {
    getMyRecommendations: tool({
      description:
        "Get the user's current AI-generated personalized recommendations. Each item carries a " +
        '`source` saying how it earned its place: a "twin" or "interest" pick was placed by a ' +
        'reserved slot rather than by the ranking, so say so instead of explaining it as being ' +
        'similar to something they watched — for a "twin" pick, similarity is exactly what did ' +
        'not choose it. Explain a twin pick with its `sharedTitles`: the films the user and that ' +
        'viewer have both watched. Never identify the other viewer behind a twin pick.',
      inputSchema: nullSafe(z.object({
        type: z.enum(['movies', 'series', 'both']).default('both'),
        limit: z.number().optional().default(15).describe('Number of results (default 15, max 50)'),
      })),
      execute: async ({ type, limit = 15 }) => {
        const items: ContentItem[] = []

        if (type === 'movies' || type === 'both') {
          const movieRecs = await query<{
            id: string
            title: string
            year: number | null
            rank: number
            genres: string[]
            overview: string | null
            poster_url: string | null
            community_rating: number | null
            provider_item_id: string | null
            directors: string[] | null
            score_breakdown: Record<string, unknown> | null
            ai_explanation: string | null
          }>(
            `SELECT m.id, m.title, m.year, rc.selected_rank as rank, m.genres, m.overview, m.poster_url,
             m.community_rating, m.provider_item_id, m.directors, rc.score_breakdown,
             rc.ai_explanation
             FROM recommendation_candidates rc
             JOIN recommendation_runs rr ON rr.id = rc.run_id
             JOIN movies m ON m.id = rc.movie_id
             WHERE rr.user_id = $1 AND rr.status = 'completed' AND rr.media_type = 'movie'
             AND rc.is_selected = true
             ORDER BY rr.created_at DESC, rc.selected_rank ASC LIMIT $2`,
            [ctx.userId, limit]
          )

          // One lookup for the whole page of picks. Resolving per item would
          // put up to `limit` round trips inside a single chat turn.
          const sharedTitles = await resolveTwinSharedTitles(
            movieRecs.rows.map((r) => r.score_breakdown),
            'movies'
          )

          for (const r of movieRecs.rows) {
            const playLink = buildPlayLink(ctx.mediaServer, r.provider_item_id, 'movie')
            items.push(
              formatContentItem(
                r as unknown as MovieResult,
                'movie',
                playLink,
                r.rank,
                pickSource(r.score_breakdown),
                readTwinSharedIds(r.score_breakdown)
                  .map((id) => sharedTitles.get(id))
                  .filter((title): title is string => Boolean(title)),
                r.ai_explanation
              )
            )
          }
        }

        if (type === 'series' || type === 'both') {
          const seriesRecs = await query<{
            id: string
            title: string
            year: number | null
            rank: number
            genres: string[]
            overview: string | null
            poster_url: string | null
            community_rating: number | null
            provider_item_id: string | null
            directors: string[] | null
            score_breakdown: Record<string, unknown> | null
            ai_explanation: string | null
          }>(
            `SELECT s.id, s.title, s.year, rc.selected_rank as rank, s.genres, s.overview, s.poster_url,
             s.community_rating, s.provider_item_id, s.directors, rc.score_breakdown,
             rc.ai_explanation
             FROM recommendation_candidates rc
             JOIN recommendation_runs rr ON rr.id = rc.run_id
             JOIN series s ON s.id = rc.series_id
             WHERE rr.user_id = $1 AND rr.status = 'completed' AND rr.media_type = 'series'
             AND rc.is_selected = true
             ORDER BY rr.created_at DESC, rc.selected_rank ASC LIMIT $2`,
            [ctx.userId, limit]
          )

          const sharedTitles = await resolveTwinSharedTitles(
            seriesRecs.rows.map((r) => r.score_breakdown),
            'series'
          )

          for (const r of seriesRecs.rows) {
            const playLink = buildPlayLink(ctx.mediaServer, r.provider_item_id, 'series')
            items.push(
              formatContentItem(
                r as unknown as SeriesResult,
                'series',
                playLink,
                r.rank,
                pickSource(r.score_breakdown),
                readTwinSharedIds(r.score_breakdown)
                  .map((id) => sharedTitles.get(id))
                  .filter((title): title is string => Boolean(title)),
                r.ai_explanation
              )
            )
          }
        }

        if (items.length === 0) {
          return {
            id: `recs-empty-${Date.now()}`,
            items: [],
            descriptionKey: 'carouselRecommendationsEmpty',
          }
        }

        return {
          id: `recs-${Date.now()}`,
          titleKey: 'carouselRecommendationsTitle',
          descriptionKey: 'carouselRecommendationsDesc',
          descriptionParams: { count: items.length },
          // Every pick carries a synopsis and, when the run wrote one, its stored
          // explanation — so these read the way the web-grounded recommendations
          // do: one card under the next, nothing hidden off the side of a scroller.
          layout: 'list' as const,
          items,
        }
      },
    }),

    searchMyRecommendations: tool({
      description:
        "Search everything the recommender has already scored for this user — their whole " +
        'unwatched library, ranked personally — by theme, mood or description. Ranks by the ' +
        "request AND the user's own taste scores, and never returns anything they have already " +
        'seen; each card comes back with a short note on why it fits. Use it when the user asks ' +
        'about their OWN library ("what do I have that\'s…"), and as the in-library fallback when ' +
        'a web-backed discovery search is unavailable or returns nothing. Prefer semanticSearch ' +
        'only for impersonal library lookups. Differs from getMyRecommendations, which returns ' +
        'the fixed short list with no query.',
      inputSchema: nullSafe(
        z.object({
          concept: z
            .string()
            .describe(
              'The theme, mood or description to search for, e.g. "slow-burn arthouse" or "heist films with an ensemble cast"'
            ),
          type: z.enum(['movies', 'series', 'both']).optional().default('both'),
          limit: z
            .number()
            .optional()
            .default(12)
            .describe('Number of results (default 12, max 30)'),
        })
      ),
      execute: async ({ concept, type = 'both', limit = 12 }) => {
        const items = await searchScoredPool(ctx, {
          concept,
          type,
          limit: Math.min(limit ?? 12, 30),
          caller: 'searchMyRecommendations',
        })

        if (items.length === 0) {
          // No completed run yet, or nothing near the request survived the
          // join. The model falls back to semanticSearch from here.
          return { id: `taste-search-empty-${Date.now()}`, items: [] }
        }

        // Every card gets a "why it fits", the same way the discovery path
        // writes them. Without this the tool returned a wall of unexplained
        // posters — which is what the web-grounded path was already doing
        // better, and the reason making this tool the default for "find me
        // something" was a downgrade rather than an upgrade.
        const explained = await enrichCardReasons(items, concept)

        return {
          id: `taste-search-${Date.now()}`,
          titleKey: 'carouselRecommendationsTitle',
          descriptionKey: 'carouselRecommendationsDesc',
          descriptionParams: { count: explained.length },
          // Same reasoning as getMyRecommendations: enrichCardReasons has just
          // given every card its own "why", which is what the vertical list is for.
          layout: 'list' as const,
          items: explained,
        }
      },
    }),

    getTopRated: tool({
      description: 'Get the highest-rated content in the library.',
      inputSchema: nullSafe(z.object({
        type: z.enum(['movies', 'series', 'both']).default('both'),
        genre: z.string().optional().describe('Filter by genre'),
        limit: z.number().optional().default(15).describe('Number of results (default 15, max 50)'),
      })),
      execute: async ({ type, genre, limit = 15 }) => {
        const items: ContentItem[] = []

        if (type === 'movies' || type === 'both') {
          let whereClause = 'WHERE community_rating IS NOT NULL'
          const params: unknown[] = []
          let paramIndex = 1

          if (genre) {
            whereClause += ` AND $${paramIndex} = ANY(genres)`
            params.push(genre)
            paramIndex++
          }
          params.push(limit)

          const movies = await query<MovieResult & { provider_item_id?: string }>(
            `SELECT id, title, year, genres, overview, community_rating, poster_url, provider_item_id, directors
             FROM movies ${whereClause}
             ORDER BY community_rating DESC LIMIT $${paramIndex}`,
            params
          )

          for (const m of movies.rows) {
            const playLink = buildPlayLink(ctx.mediaServer, m.provider_item_id, 'movie')
            items.push(formatContentItem(m, 'movie', playLink))
          }
        }

        if (type === 'series' || type === 'both') {
          let whereClause = 'WHERE community_rating IS NOT NULL'
          const params: unknown[] = []
          let paramIndex = 1

          if (genre) {
            whereClause += ` AND $${paramIndex} = ANY(genres)`
            params.push(genre)
            paramIndex++
          }
          params.push(limit)

          const series = await query<SeriesResult & { provider_item_id?: string }>(
            `SELECT id, title, year, genres, network, overview, community_rating, poster_url, provider_item_id, directors
             FROM series ${whereClause}
             ORDER BY community_rating DESC LIMIT $${paramIndex}`,
            params
          )

          for (const s of series.rows) {
            const playLink = buildPlayLink(ctx.mediaServer, s.provider_item_id, 'series')
            items.push(formatContentItem(s, 'series', playLink))
          }
        }

        return {
          id: `top-rated-${Date.now()}`,
          ...(genre
            ? {
                titleKey: 'carouselTopRatedGenreTitle' as const,
                titleParams: { genre },
              }
            : { titleKey: 'carouselTopRatedTitle' as const }),
          items,
        }
      },
    }),

    getUnwatched: tool({
      description: 'Get content the user has NOT watched yet.',
      inputSchema: nullSafe(z.object({
        type: z.enum(['movies', 'series', 'both']).default('both'),
        genre: z.string().optional().describe('Filter by genre'),
        minRating: z.number().optional().describe('Minimum community rating'),
        limit: z.number().optional().default(15).describe('Number of results (default 15, max 50)'),
      })),
      execute: async ({ type, genre, minRating, limit = 15 }) => {
        const items: ContentItem[] = []

        if (type === 'movies' || type === 'both') {
          let whereClause = `WHERE m.id NOT IN (
            SELECT wh.movie_id FROM watch_history wh
            WHERE wh.user_id = $1 AND wh.movie_id IS NOT NULL AND ${WATCH_HISTORY_PLAYED_SQL})`
          const params: unknown[] = [ctx.userId]
          let paramIndex = 2

          if (genre) {
            whereClause += ` AND $${paramIndex} = ANY(m.genres)`
            params.push(genre)
            paramIndex++
          }
          if (minRating) {
            whereClause += ` AND m.community_rating >= $${paramIndex}`
            params.push(minRating)
            paramIndex++
          }
          params.push(limit)

          const movies = await query<MovieResult & { provider_item_id?: string }>(
            `SELECT m.id, m.title, m.year, m.genres, m.overview, m.community_rating, m.poster_url, m.provider_item_id, m.directors
             FROM movies m ${whereClause}
             ORDER BY m.community_rating DESC NULLS LAST LIMIT $${paramIndex}`,
            params
          )

          for (const m of movies.rows) {
            const playLink = buildPlayLink(ctx.mediaServer, m.provider_item_id, 'movie')
            items.push(formatContentItem(m, 'movie', playLink))
          }
        }

        if (type === 'series' || type === 'both') {
          let whereClause = `WHERE s.id NOT IN (
            SELECT DISTINCT ep.series_id FROM watch_history wh
            JOIN episodes ep ON ep.id = wh.episode_id
            WHERE wh.user_id = $1 AND ${WATCH_HISTORY_PLAYED_SQL})`
          const params: unknown[] = [ctx.userId]
          let paramIndex = 2

          if (genre) {
            whereClause += ` AND $${paramIndex} = ANY(s.genres)`
            params.push(genre)
            paramIndex++
          }
          if (minRating) {
            whereClause += ` AND s.community_rating >= $${paramIndex}`
            params.push(minRating)
            paramIndex++
          }
          params.push(limit)

          const series = await query<SeriesResult & { provider_item_id?: string }>(
            `SELECT s.id, s.title, s.year, s.genres, s.network, s.overview, s.community_rating, s.poster_url, s.provider_item_id, s.directors
             FROM series s ${whereClause}
             ORDER BY s.community_rating DESC NULLS LAST LIMIT $${paramIndex}`,
            params
          )

          for (const s of series.rows) {
            const playLink = buildPlayLink(ctx.mediaServer, s.provider_item_id, 'series')
            items.push(formatContentItem(s, 'series', playLink))
          }
        }

        return {
          id: `unwatched-${Date.now()}`,
          titleKey: 'carouselUnwatchedTitle',
          descriptionKey: 'carouselUnwatchedDesc',
          descriptionParams: { count: items.length },
          items,
        }
      },
    }),
  }
}
