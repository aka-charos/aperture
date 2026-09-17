import type { FastifyPluginAsync } from 'fastify'
import { query, queryOne } from '../../lib/db.js'
import { requireAuth } from '../../plugins/auth.js'
import { getEmbeddingInvocation, getActiveEmbeddingTableName } from '@aperture/core'
import { searchSchemas, searchSchema, searchSuggestionsSchema, searchFiltersSchema } from './schemas.js'
import {
  MOVIE_SEARCH,
  SERIES_SEARCH,
  buildPrefixTsquery,
  buildTableSearch,
  type SearchFilterValues,
  type TitleSearchTable,
} from './searchSql.js'

interface SearchResult {
  id: string
  type: 'movie' | 'series'
  title: string
  original_title: string | null
  year: number | null
  genres: string[]
  overview: string | null
  poster_url: string | null
  community_rating: number | null
  rt_critic_score: number | null
  collection_name: string | null
  network: string | null
  // Search scoring
  text_rank: number
  fuzzy_similarity: number
  semantic_similarity: number | null
  combined_score: number
}

interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
  filters: {
    genre?: string
    year?: { min?: number; max?: number }
    minRtScore?: number
    collection?: string
    network?: string
    type?: 'movie' | 'series' | 'all'
  }
}

/** A row from `buildLexicalSearchSql`, plus the re-rank columns when semantic is on. */
interface SearchRow {
  id: string
  title: string
  original_title: string | null
  year: number | null
  genres: string[] | null
  overview: string | null
  poster_url: string | null
  community_rating: number | null
  rt_critic_score: number | null
  collection_name?: string | null
  network?: string | null
  text_rank: number
  coverage: number
  lexical_score: number
  semantic_similarity?: number | null
  combined_score?: number
}

/** An integer querystring value, or undefined for absent or unparseable input. */
function parseIntParam(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * The query vector, and the set it has to be compared against.
 *
 * This used to build its own OpenAI client from `getEmbeddingModel()` — the
 * LEGACY bare model name in `system_settings.embedding_model` — and
 * `getOpenAIApiKey()`. Two things were wrong with that. On any instance not
 * using OpenAI it returned null, so semantic search was silently off and the
 * route quietly degraded to text and trigram matching. And on an instance that
 * *did* have an OpenAI key while embedding its library with something else, it
 * would have compared OpenAI query vectors against Gemini item vectors — a
 * confident ranking of two unrelated spaces.
 *
 * Going through the invocation fixes both and picks up the task prefix, so the
 * query lands in the same space as the rows it is scored against.
 */
async function getQueryEmbedding(
  queryText: string
): Promise<{ embedding: number[]; setId: string } | null> {
  try {
    const { embedOne, setId } = await getEmbeddingInvocation()
    return { embedding: await embedOne(queryText), setId }
  } catch {
    // Embeddings unconfigured or unreachable: text and trigram search still work.
    return null
  }
}

const searchRoutes: FastifyPluginAsync = async (fastify) => {
  // Register schemas
  for (const [name, schema] of Object.entries(searchSchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  /**
   * GET /api/search
   * Library search: title matching (accent- and punctuation-insensitive, see
   * migration 0178), full-text over cast, crew, keywords and synopsis, and
   * optionally an embedding re-rank. Ranking lives in `searchSql.ts`.
   */
  fastify.get<{
    Querystring: {
      q: string
      type?: 'movie' | 'series' | 'all'
      genre?: string
      yearMin?: string
      yearMax?: string
      minRtScore?: string
      collection?: string
      network?: string
      limit?: string
      semantic?: string // 'true' to enable semantic search
    }
    Reply: SearchResponse
  }>('/api/search', { preHandler: requireAuth, schema: searchSchema }, async (request, reply) => {
    const {
      q: searchQuery,
      type = 'all',
      genre,
      yearMin,
      yearMax,
      minRtScore,
      collection,
      network,
      limit: limitStr,
      semantic: semanticStr,
    } = request.query

    const emptyResponse = (): SearchResponse => ({
      results: [],
      total: 0,
      query: searchQuery || '',
      filters: { type },
    })

    if (!searchQuery || searchQuery.trim().length < 2) {
      return reply.send(emptyResponse())
    }

    const limit = Math.min(Math.max(parseIntParam(limitStr) ?? 50, 1), 100)
    const yearMinNum = parseIntParam(yearMin)
    const yearMaxNum = parseIntParam(yearMax)
    const rtScoreNum = parseIntParam(minRtScore)

    // The query is folded by the same SQL function the titles are indexed by, so
    // the two sides cannot disagree about accents or punctuation.
    const keyRow = await queryOne<{ key: string | null }>('SELECT aperture_search_key($1) AS key', [
      searchQuery,
    ])
    const searchKey = keyRow?.key ?? ''
    if (searchKey.length === 0) {
      // Nothing but punctuation: there is no text to match a title against.
      return reply.send(emptyResponse())
    }
    const tsquery = buildPrefixTsquery(searchQuery)

    let semantic: { vector: string; setId: string; movieTable: string; seriesTable: string } | null = null
    if (semanticStr === 'true') {
      const q = await getQueryEmbedding(searchQuery)
      if (q) {
        try {
          semantic = {
            vector: `[${q.embedding.join(',')}]`,
            setId: q.setId,
            movieTable: await getActiveEmbeddingTableName('embeddings'),
            seriesTable: await getActiveEmbeddingTableName('series_embeddings'),
          }
        } catch {
          // No embedding table resolves: title and full-text search still work.
        }
      }
    }

    const filters: SearchFilterValues = {
      genre,
      yearMin: yearMinNum,
      yearMax: yearMaxNum,
      minRtScore: rtScoreNum,
      collection,
      network,
    }

    const runSearch = async (
      source: TitleSearchTable,
      embeddingTable: string | undefined
    ): Promise<SearchResult[]> => {
      const { sql, params } = buildTableSearch({
        source,
        tsquery,
        searchKey,
        filters,
        limit,
        embedding:
          semantic && embeddingTable
            ? { vector: semantic.vector, setId: semantic.setId, table: embeddingTable }
            : null,
      })
      const { rows } = await query<SearchRow>(sql, params)
      return rows.map((row) => ({
        id: row.id,
        type: source.table === 'movies' ? 'movie' : 'series',
        title: row.title,
        original_title: row.original_title,
        year: row.year,
        genres: row.genres || [],
        overview: row.overview,
        poster_url: row.poster_url,
        community_rating: row.community_rating,
        rt_critic_score: row.rt_critic_score,
        collection_name: row.collection_name ?? null,
        network: row.network ?? null,
        text_rank: row.text_rank,
        fuzzy_similarity: row.coverage,
        semantic_similarity: row.semantic_similarity ?? null,
        combined_score: row.combined_score ?? row.lexical_score,
      }))
    }

    const [movieResults, seriesResults] = await Promise.all([
      type === 'all' || type === 'movie'
        ? runSearch(MOVIE_SEARCH, semantic?.movieTable)
        : Promise.resolve([]),
      type === 'all' || type === 'series'
        ? runSearch(SERIES_SEARCH, semantic?.seriesTable)
        : Promise.resolve([]),
    ])

    // Both tables are scored by the same expression, so their scores compare.
    const finalResults = [...movieResults, ...seriesResults]
      .sort((a, b) => b.combined_score - a.combined_score)
      .slice(0, limit)

    return reply.send({
      results: finalResults,
      total: finalResults.length,
      query: searchQuery,
      filters: {
        type,
        genre,
        year:
          yearMinNum !== undefined || yearMaxNum !== undefined
            ? { min: yearMinNum, max: yearMaxNum }
            : undefined,
        minRtScore: rtScoreNum,
        collection,
        network,
      },
    })
  })

  /**
   * GET /api/search/suggestions
   * Get search suggestions for autocomplete
   */
  fastify.get<{
    Querystring: {
      q: string
      limit?: string
    }
  }>('/api/search/suggestions', { preHandler: requireAuth, schema: searchSuggestionsSchema }, async (request, reply) => {
    const { q: searchQuery, limit: limitStr } = request.query

    if (!searchQuery || searchQuery.trim().length < 2) {
      return reply.send({ suggestions: [] })
    }

    const limit = Math.min(parseInt(limitStr || '10', 10), 20)
    const queryLower = searchQuery.toLowerCase().trim()

    // Get matching titles using trigram similarity
    const results = await query<{
      title: string
      type: 'movie' | 'series'
      year: number | null
      similarity: number
    }>(
      `(
        SELECT title, 'movie' as type, year, similarity(title, $1) as similarity
        FROM movies
        WHERE title % $1
        ORDER BY similarity DESC
        LIMIT $2
      )
      UNION ALL
      (
        SELECT title, 'series' as type, year, similarity(title, $1) as similarity
        FROM series
        WHERE title % $1
        ORDER BY similarity DESC
        LIMIT $2
      )
      ORDER BY similarity DESC
      LIMIT $2`,
      [queryLower, limit]
    )

    return reply.send({
      suggestions: results.rows.map((r) => ({
        title: r.title,
        type: r.type,
        year: r.year,
        label: r.year ? `${r.title} (${r.year})` : r.title,
      })),
    })
  })

  /**
   * GET /api/search/filters
   * Get available filter options
   */
  fastify.get('/api/search/filters', { preHandler: requireAuth, schema: searchFiltersSchema }, async (_request, reply) => {
    // Get unique genres from both movies and series
    const genreResults = await query<{ genre: string; count: string }>(
      `SELECT genre, SUM(count)::text as count FROM (
        SELECT unnest(genres) as genre, COUNT(*) as count FROM movies GROUP BY 1
        UNION ALL
        SELECT unnest(genres) as genre, COUNT(*) as count FROM series GROUP BY 1
      ) combined
      GROUP BY genre
      ORDER BY SUM(count) DESC`
    )

    // Get collections
    const collectionResults = await query<{ name: string; count: string }>(
      `SELECT collection_name as name, COUNT(*) as count
       FROM movies WHERE collection_name IS NOT NULL
       GROUP BY collection_name
       ORDER BY COUNT(*) DESC`
    )

    // Get networks
    const networkResults = await query<{ network: string; count: string }>(
      `SELECT network, COUNT(*) as count
       FROM series WHERE network IS NOT NULL
       GROUP BY network
       ORDER BY COUNT(*) DESC
       LIMIT 50`
    )

    // Get year range
    const yearRange = await queryOne<{ min_year: number; max_year: number }>(
      `SELECT 
         MIN(LEAST(COALESCE(m.min_year, s.min_year), COALESCE(s.min_year, m.min_year))) as min_year,
         MAX(GREATEST(COALESCE(m.max_year, s.max_year), COALESCE(s.max_year, m.max_year))) as max_year
       FROM 
         (SELECT MIN(year) as min_year, MAX(year) as max_year FROM movies WHERE year IS NOT NULL) m,
         (SELECT MIN(year) as min_year, MAX(year) as max_year FROM series WHERE year IS NOT NULL) s`
    )

    return reply.send({
      genres: genreResults.rows.map((r) => ({ name: r.genre, count: parseInt(r.count, 10) })),
      collections: collectionResults.rows.map((r) => ({ name: r.name, count: parseInt(r.count, 10) })),
      networks: networkResults.rows.map((r) => ({ name: r.network, count: parseInt(r.count, 10) })),
      yearRange: yearRange
        ? { min: yearRange.min_year, max: yearRange.max_year }
        : { min: 1900, max: new Date().getFullYear() },
    })
  })
}

export default searchRoutes
