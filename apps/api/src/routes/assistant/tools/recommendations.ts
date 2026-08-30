/**
 * Recommendation tools with Tool UI output schemas
 */
import { tool } from 'ai'
import { nullSafe } from './utils.js'
import { z } from 'zod'
import { getActiveEmbeddingTableName } from '@aperture/core'
import { query, transaction } from '../../../lib/db.js'
import { readTwinSharedIds, resolveTwinSharedTitles } from '../../../lib/twinShared.js'
import { blendQueryAndTaste } from './tasteBlend.js'
import { enrichCardReasons } from '../discovery/enrichReasons.js'
import { buildPlayLink } from '../helpers/mediaServer.js'
import type { ContentItem } from '../schemas/index.js'
import type { ToolContext, MovieResult, SeriesResult } from '../types.js'

/**
 * How many nearest neighbours to pull before blending in taste.
 *
 * Big enough that the join against the scored pool still leaves plenty after
 * watched titles drop out, small enough that the re-rank stays trivial. The ANN
 * index does the expensive part; this is just how much of its output gets a
 * second opinion.
 */
const ANN_POOL_SIZE = 400

/**
 * pgvector's HNSW search-list size for the query above.
 *
 * Must be >= ANN_POOL_SIZE. The default is 40, which is smaller than the pool
 * this tool asks for, and an HNSW scan will never return more rows than
 * ef_search — so leaving it alone means either a short result or a planner that
 * gives up on the index and sequentially scans every embedding. Set per
 * statement with SET LOCAL rather than on the pool, so it cannot leak into the
 * other vector queries that are tuned for the default.
 */
const HNSW_EF_SEARCH = 500

/** Narrow the tool's plural media type to the singular one the queries use. */
const asMedia = (type: 'movies' | 'series' | 'both'): 'movie' | 'series' =>
  type === 'series' ? 'series' : 'movie'

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
function pickSource(scoreBreakdown: unknown): 'ranked' | 'twin' | 'interest' | 'acclaimed' {
  if (typeof scoreBreakdown !== 'object' || scoreBreakdown === null) return 'ranked'

  const breakdown = scoreBreakdown as Record<string, unknown>
  if (typeof breakdown.twinMatch === 'object' && breakdown.twinMatch !== null) return 'twin'
  if (typeof breakdown.interestMatch === 'object' && breakdown.interestMatch !== null) {
    return 'interest'
  }
  if (typeof breakdown.acclaimedMatch === 'object' && breakdown.acclaimedMatch !== null) {
    return 'acclaimed'
  }
  return 'ranked'
}

// Helper to format content item for Tool UI
function formatContentItem(
  item: MovieResult | SeriesResult,
  type: 'movie' | 'series',
  playLink: string | null,
  rank?: number,
  source?: 'ranked' | 'twin' | 'interest' | 'acclaimed',
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
        const safeLimit = Math.min(limit ?? 12, 30)
        const embedding = await ctx.embedding.embedOne(concept)
        const embeddingStr = `[${embedding.join(',')}]`

        const items: ContentItem[] = []

        for (const media of type === 'both' ? (['movie', 'series'] as const) : [asMedia(type)]) {
          const isMovie = media === 'movie'
          const table = await getActiveEmbeddingTableName(
            isMovie ? 'embeddings' : 'series_embeddings'
          )
          const idColumn = isMovie ? 'movie_id' : 'series_id'
          const contentTable = isMovie ? 'movies' : 'series'

          // Two stages on purpose. The ANN index answers "nearest to the
          // request" cheaply; joining that to the newest completed run's stored
          // candidates is what makes the result personal — and, because the
          // pool is by construction what the user has NOT seen, it applies the
          // pipeline's watched exclusion for free. Blending in SQL would put
          // the one piece of real arithmetic somewhere no test can reach.
          //
          // Runs in a transaction solely to carry `SET LOCAL hnsw.ef_search`.
          // pgvector's default ef_search is 40 and nothing in this repo raises
          // it, so an HNSW scan cannot produce more than 40 rows: a bare
          // `LIMIT 400` either comes back short or makes the planner abandon the
          // index for a sequential scan of the whole embedding table. The search
          // list has to be at least as large as the number of rows wanted.
          const rows = await transaction(async (client) => {
            await client.query(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`)
            return client.query<{
            id: string
            title: string
            year: number | null
            genres: string[]
            overview: string | null
            community_rating: number | null
            poster_url: string | null
            provider_item_id: string | null
            directors: string[] | null
            query_score: number
            final_score: string | number | null
            score_breakdown: Record<string, unknown> | null
          }>(
            `WITH latest AS (
               SELECT id FROM recommendation_runs
                WHERE user_id = $1 AND status = 'completed' AND media_type = $2
                ORDER BY created_at DESC
                LIMIT 1
             ),
             near AS (
               SELECT e.${idColumn} AS item_id,
                      1 - (e.embedding <=> $3::halfvec) AS query_score
                 FROM ${table} e
                WHERE e.model = $4
                ORDER BY e.embedding <=> $3::halfvec
                LIMIT $5
             )
             SELECT c.id, c.title, c.year, c.genres, c.overview, c.community_rating,
                    c.poster_url, c.provider_item_id, c.directors,
                    near.query_score, rc.final_score, rc.score_breakdown
               FROM near
               JOIN recommendation_candidates rc
                 ON rc.${idColumn} = near.item_id
                AND rc.run_id = (SELECT id FROM latest)
               JOIN ${contentTable} c ON c.id = near.item_id`,
              [ctx.userId, media, embeddingStr, ctx.embedding.setId, ANN_POOL_SIZE]
            )
          })

          // NUMERIC arrives from pg as a string; Number() it before any maths,
          // or the blend silently compares strings.
          const ranked = blendQueryAndTaste(
            rows.rows.map((r) => ({
              row: r,
              queryScore: Number(r.query_score),
              tasteScore: r.final_score != null ? Number(r.final_score) : 0,
            }))
          ).slice(0, safeLimit)

          const sharedTitles = await resolveTwinSharedTitles(
            ranked.map((r) => r.row.score_breakdown),
            isMovie ? 'movies' : 'series'
          )

          for (const { row: r } of ranked) {
            const playLink = buildPlayLink(ctx.mediaServer, r.provider_item_id, media)
            items.push(
              // Deliberately no rank. `rank` renders as a RankBadge on the
              // poster, which reads as "position in this list" — and the only
              // rank these rows carry is `recommendation_candidates.rank`, the
              // position among *everything the run scored*. Passing it stamped
              // "2012" and "449" on the first two cards. The list is already in
              // blended order, so the badge has nothing true to say here;
              // semanticSearch omits it for the same reason.
              formatContentItem(
                r as unknown as MovieResult,
                media,
                playLink,
                undefined,
                pickSource(r.score_breakdown),
                readTwinSharedIds(r.score_breakdown)
                  .map((id) => sharedTitles.get(id))
                  .filter((title): title is string => Boolean(title))
              )
            )
          }
        }

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
