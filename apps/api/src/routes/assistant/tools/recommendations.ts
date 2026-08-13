/**
 * Recommendation tools with Tool UI output schemas
 */
import { tool } from 'ai'
import { nullSafe } from './utils.js'
import { z } from 'zod'
import { query } from '../../../lib/db.js'
import { readTwinSharedIds, resolveTwinSharedTitles } from '../../../lib/twinShared.js'
import { buildPlayLink } from '../helpers/mediaServer.js'
import type { ContentItem } from '../schemas/index.js'
import type { ToolContext, MovieResult, SeriesResult } from '../types.js'

/**
 * Which reserved slot, if any, put a pick in the list.
 *
 * Derived from score_breakdown rather than passed through it, because that
 * object also holds `twinMatch.donorId` and the model must never receive an
 * identity it could name — the copy rule everywhere else in the app is
 * "someone here whose taste closely overlaps yours". An enum carries the whole
 * fact the model needs and nothing it doesn't.
 *
 * Defaults to 'ranked' for anything unrecognised, which is both the honest
 * reading of a breakdown with no slot marker and the safe one: runs written
 * before reserved slots existed simply look like ordinary picks.
 */
function pickSource(scoreBreakdown: unknown): 'ranked' | 'twin' | 'interest' {
  if (typeof scoreBreakdown !== 'object' || scoreBreakdown === null) return 'ranked'

  const breakdown = scoreBreakdown as Record<string, unknown>
  if (typeof breakdown.twinMatch === 'object' && breakdown.twinMatch !== null) return 'twin'
  if (typeof breakdown.interestMatch === 'object' && breakdown.interestMatch !== null) {
    return 'interest'
  }
  return 'ranked'
}

// Helper to format content item for Tool UI
function formatContentItem(
  item: MovieResult | SeriesResult,
  type: 'movie' | 'series',
  playLink: string | null,
  rank?: number,
  source?: 'ranked' | 'twin' | 'interest',
  sharedTitles?: string[]
): ContentItem {
  const genres = item.genres?.slice(0, 2).join(', ') || ''
  const subtitle = [item.year, genres].filter(Boolean).join(' · ')

  return {
    id: item.id,
    type,
    name: item.title,
    subtitle,
    image: item.poster_url,
    // For a series this column holds the creators — the card labels it accordingly.
    director: (item.directors ?? []).slice(0, 2).join(', ') || null,
    overview: item.overview ?? null,
    rating: item.community_rating,
    rank,
    ...(source ? { source } : {}),
    ...(sharedTitles?.length ? { sharedTitles } : {}),
    actions: [
      {
        id: 'details',
        label: 'Details',
        href: `/${type === 'movie' ? 'movies' : 'series'}/${item.id}`,
        variant: 'secondary',
      },
      ...(playLink
        ? [{ id: 'play', label: 'Play', href: playLink, variant: 'primary' as const }]
        : []),
    ],
  }
}

export function createRecommendationTools(ctx: ToolContext) {
  return {
    getMyRecommendations: tool({
      description:
        "Get the user's current AI-generated personalized recommendations. Each item carries a " +
        '`source` saying how it earned its place: a "twin" or "interest" pick was placed by a ' +
        'reserved slot rather than by the ranking, so say so instead of explaining it as being ' +
        'similar to something they watched — for a "twin" pick similarity is exactly what did ' +
        'not choose it — use its `sharedTitles`, the films the user and that viewer have both ' +
        'watched, to explain it concretely. Never identify the other viewer behind a twin pick.',
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
          }>(
            `SELECT m.id, m.title, m.year, rc.selected_rank as rank, m.genres, m.overview, m.poster_url,
             m.community_rating, m.provider_item_id, m.directors, rc.score_breakdown
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
                  .filter((title): title is string => Boolean(title))
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
          }>(
            `SELECT s.id, s.title, s.year, rc.selected_rank as rank, s.genres, s.overview, s.poster_url,
             s.community_rating, s.provider_item_id, s.directors, rc.score_breakdown
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
                  .filter((title): title is string => Boolean(title))
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
          items,
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
            SELECT movie_id FROM watch_history WHERE user_id = $1 AND movie_id IS NOT NULL)`
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
            WHERE wh.user_id = $1)`
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
