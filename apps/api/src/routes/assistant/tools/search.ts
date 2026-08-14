/**
 * Search and similarity tools with Tool UI output schemas
 */
import { tool, embed } from 'ai'
import { nullSafe } from './utils.js'
import { z } from 'zod'
import { getActiveEmbeddingTableName } from '@aperture/core'
import { query, queryOne, transaction } from '../../../lib/db.js'
import { buildPlayLink } from '../helpers/mediaServer.js'
import { annotateWatchedItems } from '../helpers/unwatched.js'
import { anyTitleMatchesSql, titleMatchRankSql } from '../helpers/titleMatch.js'
import { normalizeCountryQuery } from '../helpers/countryMatch.js'
import { briefResult, FORMAT_PARAM_DESCRIPTION } from './utils.js'
import type { ContentCarouselI18nKey } from '../schemas/contentCarousel.js'
import type { ContentItem } from '../schemas/index.js'
import type { ToolContext, MovieResult, SeriesResult } from '../types.js'

function searchContentTitleKey(
  searchQuery: string | undefined,
  genre: string | undefined,
  type: 'movies' | 'series' | 'both'
): { titleKey: ContentCarouselI18nKey; titleParams?: Record<string, string | number> } {
  if (searchQuery) {
    return { titleKey: 'carouselSearchTitleQuery', titleParams: { query: searchQuery } }
  }
  if (genre) {
    if (type === 'movies') return { titleKey: 'carouselSearchTitleGenreMovies', titleParams: { genre } }
    if (type === 'series') return { titleKey: 'carouselSearchTitleGenreSeries', titleParams: { genre } }
    return { titleKey: 'carouselSearchTitleGenreBoth', titleParams: { genre } }
  }
  return { titleKey: 'carouselSearchTitleDefault' }
}

function semanticSearchTitleKey(type: 'movies' | 'series' | 'both'): ContentCarouselI18nKey {
  if (type === 'movies') return 'carouselSemanticTitleMovies'
  if (type === 'series') return 'carouselSemanticTitleSeries'
  return 'carouselSemanticTitleBoth'
}

function similarSuccessDescriptionKey(
  foundType: 'movie' | 'series',
  excludeWatched: boolean
): ContentCarouselI18nKey {
  if (foundType === 'movie') {
    return excludeWatched ? 'carouselSimilarDescMovieUnwatched' : 'carouselSimilarDescMovie'
  }
  return excludeWatched ? 'carouselSimilarDescSeriesUnwatched' : 'carouselSimilarDescSeries'
}

// Helper to format content item for Tool UI
function formatContentItem(
  item: MovieResult | SeriesResult,
  type: 'movie' | 'series',
  playLink: string | null,
  rank?: number
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
    // Every card shows a synopsis. Without it the embeddings-sourced sections
    // ("Also worth checking") rendered as bare title+year next to fully
    // described web picks — the same card component looking half-built.
    overview: item.overview ?? null,
    rating: item.community_rating,
    rank,
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

export type WatchStatus = 'all' | 'watched' | 'unwatched'

/**
 * HNSW search-list size for a semantic query carrying a watch-status filter.
 *
 * pgvector applies a WHERE predicate AFTER the index scan, and an HNSW scan
 * never yields more rows than `ef_search` (default 40). Asking for 20 watched
 * titles out of a library where most things are unwatched would therefore come
 * back nearly empty — the filter would look broken when the index was simply
 * not asked to walk far enough. SET LOCAL only, so it cannot leak onto the
 * pooled connection and change the vector queries tuned for the default.
 */
const HNSW_EF_SEARCH_FILTERED = 500

/**
 * SQL predicate restricting rows to titles the user has (or has not) watched.
 *
 * The exclusion half already existed in several places; the INCLUSION half is
 * what makes "which French film noir have I watched" answerable at all. Before
 * it, the only history tool was getWatchHistory — most-recent-N in play order,
 * with no filter of any kind — so the model had to infer membership by eye from
 * a sample, and reported confident false negatives when the sample missed.
 *
 * `column` is the id column of the row being filtered ('id' when the table is
 * unaliased, 'm.id'/'s.id' when it is). A watched SERIES means at least one of
 * its episodes was played, matching every other watched check in the codebase.
 */
function watchStatusCondition(
  status: Exclude<WatchStatus, 'all'>,
  isMovie: boolean,
  column: string,
  paramIdx: number
): string {
  const subquery = isMovie
    ? `SELECT movie_id FROM watch_history WHERE user_id = $${paramIdx} AND movie_id IS NOT NULL`
    : `SELECT DISTINCT ep.series_id FROM watch_history wh
       JOIN episodes ep ON ep.id = wh.episode_id
       WHERE wh.user_id = $${paramIdx}`
  return `${column} ${status === 'watched' ? 'IN' : 'NOT IN'} (${subquery})`
}

export interface SimilarItemsResult {
  items: ContentItem[]
  foundTitle: string
  foundType: 'movie' | 'series' | ''
  /** Seed resolved to a library item but has no stored embedding for the active model. */
  noEmbedding: boolean
}

/**
 * Core of findSimilarContent: resolve a title to a library movie/series and
 * return its nearest neighbours by embedding. Extracted so the discovery tool
 * can reuse it for the secondary "Also worth checking" carousel. Throws on DB
 * errors — callers decide how to surface them.
 */
export async function findSimilarItems(
  ctx: ToolContext,
  title: string,
  opts?: { type?: 'movies' | 'series'; excludeWatched?: boolean; limit?: number }
): Promise<SimilarItemsResult> {
  const type = opts?.type
  const excludeWatched = opts?.excludeWatched ?? false
  const limit = opts?.limit ?? 15

  /**
   * The watched-exclusion filter below is a post-filter on the ANN scan, so the
   * scan has to be told to walk further — same trap as the watchStatus path, see
   * HNSW_EF_SEARCH_FILTERED. Without it, "Also worth checking" quietly returns
   * fewer than `limit` items for anyone with a well-watched library, and the
   * shortfall grows with how much of the library they have seen.
   */
  const runAnn = async <T,>(sql: string, params: unknown[]): Promise<{ rows: T[] }> => {
    if (!excludeWatched) return query<T>(sql, params)
    return transaction(async (client) => {
      await client.query(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH_FILTERED}`)
      const res = await client.query(sql, params)
      return { rows: res.rows as T[] }
    })
  }

  const items: ContentItem[] = []
  let foundTitle = ''
  let foundType: 'movie' | 'series' | '' = ''

  const searchMovies = !type || type === 'movies'
  const searchSeries = !type || type === 'series'
  const modelId = ctx.embeddingModelId

  interface MovieWithMeta {
    id: string
    title: string
    overview: string | null
    year: number | null
    tagline: string | null
    directors: string[] | null
    actors: Array<{ name: string }> | null
    studios: string[] | null
    tags: string[] | null
  }
  let movie: MovieWithMeta | null = null
  if (searchMovies) {
    const movieEmbeddingTable = await getActiveEmbeddingTableName('embeddings')
    movie = await queryOne<MovieWithMeta>(
      `SELECT m.id, m.title, m.overview, m.year, m.tagline, m.directors, m.actors, m.studios, m.tags
       FROM movies m
       LEFT JOIN ${movieEmbeddingTable} e ON e.movie_id = m.id AND e.model = $2
       WHERE ${anyTitleMatchesSql('$1', 'm')}
       ORDER BY
         ${titleMatchRankSql('$3', 'm')},
         CASE WHEN unaccent(LOWER(m.title)) LIKE unaccent(LOWER($4)) THEN 0 ELSE 1 END,
         e.id IS NOT NULL DESC
       LIMIT 1`,
      [`%${title}%`, modelId, title, `${title}%`]
    )
  }

  let series: { id: string; title: string; overview: string | null; year: number | null } | null = null
  if (searchSeries) {
    const seriesEmbeddingTable = await getActiveEmbeddingTableName('series_embeddings')
    series = await queryOne<{ id: string; title: string; overview: string | null; year: number | null }>(
      `SELECT s.id, s.title, s.overview, s.year FROM series s
       LEFT JOIN ${seriesEmbeddingTable} se ON se.series_id = s.id AND se.model = $2
       WHERE ${anyTitleMatchesSql('$1', 's')}
       ORDER BY
         ${titleMatchRankSql('$3', 's')},
         CASE WHEN unaccent(LOWER(s.title)) LIKE unaccent(LOWER($4)) THEN 0 ELSE 1 END,
         se.id IS NOT NULL DESC
       LIMIT 1`,
      [`%${title}%`, modelId, title, `${title}%`]
    )
  }

  if (!movie && !series) {
    return { items, foundTitle: '', foundType: '', noEmbedding: false }
  }

  const useMovie = movie && (!series || type === 'movies')
  const useSeries = series && (!movie || type === 'series')

  if (useMovie && movie) {
    foundTitle = movie.title
    foundType = 'movie'

    const movieEmbeddingTable = await getActiveEmbeddingTableName('embeddings')
    const embeddingResult = await queryOne<{ embedding: string }>(
      `SELECT embedding::text FROM ${movieEmbeddingTable} WHERE movie_id = $1 AND model = $2`,
      [movie.id, modelId]
    )
    if (!embeddingResult) {
      return { items, foundTitle, foundType, noEmbedding: true }
    }
    const embeddingStr = embeddingResult.embedding

    const watchedFilter = excludeWatched
      ? `AND m.id NOT IN (SELECT movie_id FROM watch_history WHERE user_id = $4 AND movie_id IS NOT NULL)`
      : ''
    const params = excludeWatched
      ? [movie.id, modelId, embeddingStr, ctx.userId, limit]
      : [movie.id, modelId, embeddingStr, limit]

    const similar = await runAnn<MovieResult & { provider_item_id?: string }>(
      `SELECT m.id, m.title, m.year, m.genres, m.overview, m.community_rating, m.poster_url, m.provider_item_id, m.directors
       FROM ${movieEmbeddingTable} e JOIN movies m ON m.id = e.movie_id
       WHERE e.movie_id != $1 AND e.model = $2 ${watchedFilter}
       ORDER BY e.embedding <=> $3::halfvec
       LIMIT ${excludeWatched ? '$5' : '$4'}`,
      params
    )
    for (const m of similar.rows) {
      const playLink = buildPlayLink(ctx.mediaServer, m.provider_item_id, 'movie')
      items.push(formatContentItem(m, 'movie', playLink))
    }
  } else if (useSeries && series) {
    foundTitle = series.title
    foundType = 'series'

    const seriesEmbeddingTable = await getActiveEmbeddingTableName('series_embeddings')
    const embeddingResult = await queryOne<{ embedding: string }>(
      `SELECT embedding::text FROM ${seriesEmbeddingTable} WHERE series_id = $1 AND model = $2`,
      [series.id, modelId]
    )
    if (!embeddingResult) {
      return { items, foundTitle, foundType, noEmbedding: true }
    }
    const embeddingStr = embeddingResult.embedding

    const watchedFilter = excludeWatched
      ? `AND s.id NOT IN (
          SELECT DISTINCT ep.series_id FROM watch_history wh
          JOIN episodes ep ON ep.id = wh.episode_id
          WHERE wh.user_id = $4
        )`
      : ''
    const params = excludeWatched
      ? [series.id, modelId, embeddingStr, ctx.userId, limit]
      : [series.id, modelId, embeddingStr, limit]

    const similar = await runAnn<SeriesResult & { provider_item_id?: string }>(
      `SELECT s.id, s.title, s.year, s.genres, s.network, s.overview, s.community_rating, s.poster_url, s.provider_item_id, s.directors
       FROM ${seriesEmbeddingTable} se
       JOIN series s ON s.id = se.series_id
       WHERE se.series_id != $1
         AND se.model = $2
         ${watchedFilter}
       ORDER BY se.embedding <=> $3::halfvec
       LIMIT ${excludeWatched ? '$5' : '$4'}`,
      params
    )
    for (const s of similar.rows) {
      const playLink = buildPlayLink(ctx.mediaServer, s.provider_item_id, 'series')
      items.push(formatContentItem(s, 'series', playLink))
    }
  }

  return { items, foundTitle, foundType, noEmbedding: false }
}

export function createSearchTools(ctx: ToolContext) {
  return {
    searchContent: tool({
      description:
        'Comprehensive search for movies and TV series with ALL available filters. Use for specific queries with known criteria. For conceptual/vague queries like "mind-bending movies", use semanticSearch instead. Set watchStatus to search WITHIN what the user has (or has not) watched — this is the only way to answer "which X have I seen", since getWatchHistory returns recent plays in order and cannot filter.',
      inputSchema: nullSafe(z.object({
        // Text search
        query: z
          .string()
          .optional()
          .describe(
            'Literal text to find in the title or plot summary. NOT a concept search: ' +
              '"noir", "slow-burn", "feel-good" will match almost nothing, because those ' +
              'words rarely appear in a title or synopsis. Use semanticSearch for a mood, ' +
              'style or theme, and this only for words you expect to be written down.'
          ),

        // Basic filters
        genre: z
          .string()
          .optional()
          .describe('Genre (e.g. "Action", "Comedy", "Drama", "Science Fiction", "Horror")'),
        year: z.number().optional().describe('Exact release year'),
        yearMin: z.number().optional().describe('Minimum release year (for ranges)'),
        yearMax: z.number().optional().describe('Maximum release year (for ranges)'),

        // Ratings
        minRating: z.number().optional().describe('Minimum community rating (0-10)'),
        maxRating: z.number().optional().describe('Maximum community rating (0-10)'),
        minCriticRating: z.number().optional().describe('Minimum critic rating (0-100)'),

        // Content rating (MPAA/TV ratings)
        contentRating: z
          .string()
          .optional()
          .describe(
            'Content rating: G, PG, PG-13, R, NC-17, TV-Y, TV-Y7, TV-G, TV-PG, TV-14, TV-MA'
          ),

        // Runtime (movies)
        minRuntime: z.number().optional().describe('Minimum runtime in minutes'),
        maxRuntime: z.number().optional().describe('Maximum runtime in minutes'),

        // People
        director: z.string().optional().describe('Director name'),
        actor: z.string().optional().describe('Actor name'),

        // Production
        studio: z.string().optional().describe('Studio or production company name'),
        network: z.string().optional().describe('TV network (for series): HBO, Netflix, AMC, etc.'),

        // Origin
        country: z
          .string()
          .optional()
          .describe(
            'Production country — the filter for national cinema ("French films", ' +
              '"Korean thrillers", "a Japanese horror"). Either the country ("France") ' +
              'or the nationality ("French") works.'
          ),

        // Watch status
        watchStatus: z
          .enum(['all', 'watched', 'unwatched'])
          .optional()
          .default('all')
          .describe(
            'Restrict to titles the user HAS watched ("watched"), has NOT watched ' +
              '("unwatched"), or both ("all", the default). Use "watched" for any question ' +
              'about what they have already seen — "which French noir have I watched", "have ' +
              'I seen any Kurosawa" — because getWatchHistory can only return their most ' +
              'recent plays in order and cannot filter by genre, country, era or theme.'
          ),

        // Series-specific
        status: z.enum(['Continuing', 'Ended']).optional().describe('Series status'),
        minSeasons: z.number().optional().describe('Minimum number of seasons'),

        // Tags
        tag: z.string().optional().describe('Content tag (e.g. "superhero", "based on novel")'),

        // Type and limit
        type: z.enum(['movies', 'series', 'both']).optional().default('both'),
        limit: z.number().optional().default(15).describe('Number of results (default 15, max 50)'),

        // Sorting
        sortBy: z
          .enum(['rating', 'year', 'title', 'runtime', 'critic_rating'])
          .optional()
          .default('rating'),
        sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),

        format: z.enum(['cards', 'brief']).optional().default('cards')
          .describe(FORMAT_PARAM_DESCRIPTION),
      })),
      execute: async (params) => {
        const {
          query: searchQuery,
          genre,
          year,
          yearMin,
          yearMax,
          minRating,
          maxRating,
          minCriticRating,
          contentRating,
          minRuntime,
          maxRuntime,
          director,
          actor,
          studio,
          network,
          country,
          watchStatus = 'all',
          status,
          minSeasons,
          tag,
          type = 'both',
          limit = 15,
          sortBy = 'rating',
          sortOrder = 'desc',
          format = 'cards',
        } = params

        const items: ContentItem[] = []
        // ContentItem folds the year into `subtitle`; a brief line wants it back.
        const yearById = new Map<string, number | null>()
        const seenTitles = new Set<string>()
        const safeLimit = Math.min(limit ?? 15, 50)

        // Helper to build WHERE clause
        const buildWhere = (isMovie: boolean) => {
          const conditions: string[] = []
          const values: unknown[] = []
          let idx = 1

          if (searchQuery) {
            // Original/sort titles too: a third of a real library carries a
            // different original title, so "Ascenseur pour l'échafaud" found
            // nothing while the film sat there as "Elevator to the Gallows".
            conditions.push(
              `(${anyTitleMatchesSql(`$${idx}`)} OR unaccent(overview) ILIKE unaccent($${idx}))`
            )
            values.push(`%${searchQuery}%`)
            idx++
          }
          if (genre) {
            conditions.push(`$${idx} = ANY(genres)`)
            values.push(genre)
            idx++
          }
          if (year) {
            conditions.push(`year = $${idx}`)
            values.push(year)
            idx++
          }
          if (yearMin) {
            conditions.push(`year >= $${idx}`)
            values.push(yearMin)
            idx++
          }
          if (yearMax) {
            conditions.push(`year <= $${idx}`)
            values.push(yearMax)
            idx++
          }
          if (minRating) {
            conditions.push(`community_rating >= $${idx}`)
            values.push(minRating)
            idx++
          }
          if (maxRating) {
            conditions.push(`community_rating <= $${idx}`)
            values.push(maxRating)
            idx++
          }
          if (minCriticRating) {
            conditions.push(`critic_rating >= $${idx}`)
            values.push(minCriticRating)
            idx++
          }
          if (contentRating) {
            conditions.push(`content_rating ILIKE $${idx}`)
            values.push(contentRating)
            idx++
          }
          if (minRuntime && isMovie) {
            conditions.push(`runtime_minutes >= $${idx}`)
            values.push(minRuntime)
            idx++
          }
          if (maxRuntime && isMovie) {
            conditions.push(`runtime_minutes <= $${idx}`)
            values.push(maxRuntime)
            idx++
          }
          if (director) {
            // `directors::text ILIKE $n`, matching the actor/studio filters below.
            // This was `$n ILIKE ANY(directors)`, which is backwards: in
            // `a ILIKE b` the RIGHT side is the pattern, so that asked whether the
            // literal string "%Nolan%" matches the pattern "Christopher Nolan" —
            // false for every real name, making the filter silently return nothing.
            conditions.push(`directors::text ILIKE $${idx}`)
            values.push(`%${director}%`)
            idx++
          }
          if (actor) {
            conditions.push(`actors::text ILIKE $${idx}`)
            values.push(`%${actor}%`)
            idx++
          }
          if (studio) {
            conditions.push(`studios::text ILIKE $${idx}`)
            values.push(`%${studio}%`)
            idx++
          }
          if (network && !isMovie) {
            conditions.push(`network ILIKE $${idx}`)
            values.push(`%${network}%`)
            idx++
          }
          if (status && !isMovie) {
            conditions.push(`status = $${idx}`)
            values.push(status)
            idx++
          }
          if (minSeasons && !isMovie) {
            conditions.push(`total_seasons >= $${idx}`)
            values.push(minSeasons)
            idx++
          }
          if (tag) {
            // Same inversion as the director filter above — see the note there.
            conditions.push(`tags::text ILIKE $${idx}`)
            values.push(`%${tag}%`)
            idx++
          }
          if (country) {
            // "French" has to find {France,Italy}; see countryMatch.ts.
            conditions.push(`production_countries::text ILIKE $${idx}`)
            values.push(`%${normalizeCountryQuery(country)}%`)
            idx++
          }
          if (watchStatus !== 'all') {
            conditions.push(watchStatusCondition(watchStatus, isMovie, 'id', idx))
            values.push(ctx.userId)
            idx++
          }

          values.push(safeLimit)
          const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
          return { whereClause, values, limitIdx: idx }
        }

        // Sort column mapping
        const sortColumn =
          {
            rating: 'community_rating',
            year: 'year',
            title: 'title',
            runtime: 'runtime_minutes',
            critic_rating: 'critic_rating',
          }[sortBy] || 'community_rating'
        const order = sortOrder === 'asc' ? 'ASC' : 'DESC'
        const nullsOrder = sortOrder === 'asc' ? 'NULLS FIRST' : 'NULLS LAST'

        if (type === 'movies' || type === 'both') {
          const { whereClause, values, limitIdx } = buildWhere(true)
          const movieResult = await query<MovieResult & { provider_item_id?: string }>(
            `SELECT id, title, year, genres, overview, community_rating, poster_url, provider_item_id, directors
             FROM movies ${whereClause}
             ORDER BY ${sortColumn} ${order} ${nullsOrder} LIMIT $${limitIdx}`,
            values
          )

          for (const m of movieResult.rows) {
            const titleKey = m.title.toLowerCase()
            if (!seenTitles.has(titleKey)) {
              seenTitles.add(titleKey)
              const playLink = buildPlayLink(ctx.mediaServer, m.provider_item_id, 'movie')
              yearById.set(m.id, m.year)
              items.push(formatContentItem(m, 'movie', playLink))
            }
          }
        }

        if (type === 'series' || type === 'both') {
          const { whereClause, values, limitIdx } = buildWhere(false)
          const seriesResult = await query<SeriesResult & { provider_item_id?: string }>(
            `SELECT id, title, year, genres, network, overview, community_rating, poster_url, provider_item_id, directors
             FROM series ${whereClause}
             ORDER BY ${sortColumn !== 'runtime_minutes' ? sortColumn : 'community_rating'} ${order} ${nullsOrder} LIMIT $${limitIdx}`,
            values
          )

          for (const s of seriesResult.rows) {
            const titleKey = s.title.toLowerCase()
            if (!seenTitles.has(titleKey)) {
              seenTitles.add(titleKey)
              const playLink = buildPlayLink(ctx.mediaServer, s.provider_item_id, 'series')
              yearById.set(s.id, s.year)
              items.push(formatContentItem(s, 'series', playLink))
            }
          }
        }

        if (items.length === 0) {
          return {
            id: `search-empty-${Date.now()}`,
            items: [],
            descriptionKey: 'carouselSearchNoResults',
          }
        }

        // Tell the model (and the card) which of these the user has already
        // seen, so "have I watched any of these" is read off the data instead
        // of guessed. One round trip for the whole page.
        await annotateWatchedItems(ctx.userId, items)

        if (format === 'brief') {
          // After annotation, so a private lookup can answer "have they seen
          // these?" — which is the main reason to make one.
          return briefResult(
            `search-${Date.now()}`,
            items.map((i) => ({
              name: i.name,
              year: yearById.get(i.id) ?? null,
              note: i.watched === true ? 'watched' : null,
            }))
          )
        }

        const { titleKey, titleParams } = searchContentTitleKey(searchQuery, genre, type)
        return {
          id: `search-${Date.now()}`,
          titleKey,
          ...(titleParams ? { titleParams } : {}),
          items,
        }
      },
    }),

    semanticSearch: tool({
      description:
        'Search for movies and TV series by concept, theme, mood, or description using AI embeddings. BEST for vague or conceptual queries like "mind-bending sci-fi", "feel-good comedies", "dark thrillers with plot twists", "movies like Inception but darker". Use this instead of searchContent for non-literal searches.',
      inputSchema: nullSafe(z.object({
        concept: z
          .string()
          .describe(
            'The concept, theme, mood, or description to search for. Be descriptive - e.g. "psychological thrillers with unreliable narrators" or "uplifting sports underdog stories"'
          ),
        type: z.enum(['movies', 'series', 'both']).optional().default('both'),
        excludeTitle: z
          .string()
          .optional()
          .describe('Title to EXCLUDE from results (use when user says "I liked X, what else...")'),
        watchStatus: z
          .enum(['all', 'watched', 'unwatched'])
          .optional()
          .default('all')
          .describe(
            'Restrict to titles the user HAS watched ("watched"), has NOT watched ' +
              '("unwatched"), or both ("all", the default). Use "watched" to search their ' +
              'history by theme or mood — "the bleak thrillers I have seen" — which ' +
              'getWatchHistory cannot do, as it only returns recent plays in order.'
          ),
        country: z
          .string()
          .optional()
          .describe(
            'Restrict to a production country. This is what makes national cinema ' +
              'answerable: "French film noir" is concept "film noir" + country "France", ' +
              'because the noir part is a style (not searchable as text) and the French ' +
              'part is a fact about the row. Country or nationality both work.'
          ),
        limit: z
          .number()
          .optional()
          .default(15)
          .describe('Number of results to return (default 15, max 50)'),
        format: z
          .enum(['cards', 'brief'])
          .optional()
          .default('cards')
          .describe(FORMAT_PARAM_DESCRIPTION),
      })),
      execute: async ({
        concept,
        type = 'both',
        excludeTitle,
        watchStatus = 'all',
        country,
        limit = 15,
        format = 'cards',
      }) => {
        try {
          const safeLimit = Math.min(limit ?? 15, 50)

          // Generate embedding for the search concept using AI SDK
          const { embedding: queryEmbedding } = await embed({
            model: ctx.embeddingModel,
            value: concept,
          })
          const embeddingStr = `[${queryEmbedding.join(',')}]`

          const items: ContentItem[] = []
          // ContentItem folds the year into `subtitle`; a brief line wants it back.
          const yearById = new Map<string, number | null>()
          const seenTitles = new Set<string>() // Deduplicate by title

          // If user mentioned a title they already watched, exclude it
          const excludeLower = excludeTitle?.toLowerCase()

          // Get model ID for database query (stored in db as string identifier)
          const modelId = ctx.embeddingModelId

          // Watch status and country are both post-filters on the ANN scan, so
          // either one needs a wider search list to have anything left to
          // filter — see HNSW_EF_SEARCH_FILTERED.
          const filterWatch = watchStatus !== 'all'
          const countryFilter = country?.trim() ? normalizeCountryQuery(country) : null
          const hasPostFilter = filterWatch || countryFilter !== null
          const runAnn = async <T,>(sql: string, params: unknown[]): Promise<{ rows: T[] }> => {
            if (!hasPostFilter) return query<T>(sql, params)
            return transaction(async (client) => {
              await client.query(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH_FILTERED}`)
              const res = await client.query(sql, params)
              return { rows: res.rows as T[] }
            })
          }

          // $1 embedding, $2 model and $3 limit are fixed; the optional filters
          // take the next indices in a fixed order, so the movie and series
          // halves stay in agreement about which parameter is which.
          const buildFilters = (isMovie: boolean, alias: string) => {
            const clauses: string[] = []
            const extra: unknown[] = []
            let idx = 4
            if (filterWatch) {
              clauses.push(`AND ${watchStatusCondition(watchStatus, isMovie, `${alias}.id`, idx)}`)
              extra.push(ctx.userId)
              idx++
            }
            if (countryFilter) {
              clauses.push(`AND ${alias}.production_countries::text ILIKE $${idx}`)
              extra.push(`%${countryFilter}%`)
              idx++
            }
            return { clause: clauses.join(' '), extra }
          }

          if (type === 'movies' || type === 'both') {
            const movieTableName = await getActiveEmbeddingTableName('embeddings')
            const { clause, extra } = buildFilters(true, 'm')
            const movieResults = await runAnn<
              MovieResult & { provider_item_id?: string; similarity: number }
            >(
              `SELECT m.id, m.title, m.year, m.genres, m.overview, m.community_rating, m.poster_url, m.provider_item_id, m.directors,
                      1 - (e.embedding <=> $1::halfvec) as similarity
               FROM ${movieTableName} e
               JOIN movies m ON m.id = e.movie_id
               WHERE e.model = $2 ${clause}
               ORDER BY e.embedding <=> $1::halfvec
               LIMIT $3`,
              // Extra rows to absorb the excluded title and any duplicates.
              [embeddingStr, modelId, safeLimit + 5, ...extra]
            )

            for (const m of movieResults.rows) {
              const titleKey = m.title.toLowerCase()
              // Skip if this is the excluded title or a duplicate
              if (excludeLower && titleKey.includes(excludeLower)) continue
              if (seenTitles.has(titleKey)) continue
              seenTitles.add(titleKey)
              const playLink = buildPlayLink(ctx.mediaServer, m.provider_item_id, 'movie')
              yearById.set(m.id, m.year)
              items.push(formatContentItem(m, 'movie', playLink))
            }
          }

          if (type === 'series' || type === 'both') {
            const seriesTableName = await getActiveEmbeddingTableName('series_embeddings')
            const { clause, extra } = buildFilters(false, 's')
            const seriesResults = await runAnn<
              SeriesResult & { provider_item_id?: string; similarity: number }
            >(
              `SELECT s.id, s.title, s.year, s.genres, s.network, s.overview, s.community_rating, s.poster_url, s.provider_item_id, s.directors,
                      1 - (se.embedding <=> $1::halfvec) as similarity
               FROM ${seriesTableName} se
               JOIN series s ON s.id = se.series_id
               WHERE se.model = $2 ${clause}
               ORDER BY se.embedding <=> $1::halfvec
               LIMIT $3`,
              // Extra rows to absorb the excluded title and any duplicates.
              [embeddingStr, modelId, safeLimit + 5, ...extra]
            )

            for (const s of seriesResults.rows) {
              const titleKey = s.title.toLowerCase()
              // Skip if this is the excluded title or a duplicate
              if (excludeLower && titleKey.includes(excludeLower)) continue
              if (seenTitles.has(titleKey)) continue
              seenTitles.add(titleKey)
              const playLink = buildPlayLink(ctx.mediaServer, s.provider_item_id, 'series')
              yearById.set(s.id, s.year)
              items.push(formatContentItem(s, 'series', playLink))
            }
          }

          // Sort combined results by rating (since we can't compare similarity scores across tables)
          items.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))

          // Limit final results
          const finalItems = items.slice(0, safeLimit)
          await annotateWatchedItems(ctx.userId, finalItems)

          if (format === 'brief') {
            return briefResult(
              `semantic-${Date.now()}`,
              finalItems.map((i) => ({
                name: i.name,
                year: yearById.get(i.id) ?? null,
                note: i.watched === true ? 'watched' : null,
              }))
            )
          }

          if (finalItems.length === 0) {
            return {
              id: `semantic-empty-${Date.now()}`,
              items: [],
              descriptionKey: 'carouselSemanticEmpty',
              descriptionParams: { concept },
            }
          }

          return {
            id: `semantic-${Date.now()}`,
            titleKey: semanticSearchTitleKey(type),
            titleParams: { concept },
            descriptionKey: 'carouselSemanticDesc',
            descriptionParams: { count: finalItems.length },
            items: finalItems,
          }
        } catch (err) {
          console.error('[semanticSearch] Error:', err)
          return {
            id: `semantic-error-${Date.now()}`,
            items: [],
            descriptionKey: 'carouselSemanticError',
            descriptionParams: {
              message: err instanceof Error ? err.message : 'Unknown error',
            },
          }
        }
      },
    }),

    findSimilarContent: tool({
      description:
        'Find movies or TV series similar to a given title using AI embeddings. Returns ONLY the same type (movies for movies, series for series). Can optionally exclude content the user has already watched.',
      inputSchema: nullSafe(z.object({
        title: z.string().describe('The title to find similar content for'),
        type: z
          .enum(['movies', 'series'])
          .optional()
          .describe('Force search type. If omitted, auto-detects from title.'),
        excludeWatched: z
          .boolean()
          .optional()
          .default(false)
          .describe('If true, only return unwatched content'),
        limit: z
          .number()
          .optional()
          .default(15)
          .describe('Number of results to return (default 15, max 50)'),
      })),
      execute: async ({ title, type, excludeWatched = false, limit = 15 }) => {
        try {
          const sim = await findSimilarItems(ctx, title, { type, excludeWatched, limit })
          const { items, foundTitle, foundType } = sim

          if (!foundTitle) {
            return {
              id: `similar-error-${Date.now()}`,
              items: [],
              descriptionKey: 'carouselSimilarLookupNotFound',
              descriptionParams: { title },
            }
          }
          if (sim.noEmbedding) {
            return {
              id: `similar-error-${Date.now()}`,
              items: [],
              descriptionKey: 'carouselSimilarNoEmbedding',
              descriptionParams: { title: foundTitle },
            }
          }
          if (items.length === 0) {
            return {
              id: `similar-empty-${Date.now()}`,
              items: [],
              descriptionKey:
                foundType === 'movie' ? 'carouselSimilarEmptyMovie' : 'carouselSimilarEmptySeries',
              descriptionParams: { title: foundTitle },
            }
          }

          return {
            id: `similar-${Date.now()}`,
            titleKey: 'carouselSimilarTitle',
            titleParams: { title: foundTitle },
            descriptionKey: similarSuccessDescriptionKey(
              foundType === 'series' ? 'series' : 'movie',
              excludeWatched
            ),
            descriptionParams: { count: items.length },
            items,
          }
        } catch (err) {
          console.error('[findSimilarContent] Error:', err)
          return {
            id: `similar-error-${Date.now()}`,
            items: [],
            descriptionKey: 'carouselSimilarError',
            descriptionParams: {
              message: err instanceof Error ? err.message : 'Unknown error',
            },
          }
        }
      },
    }),
  }
}
