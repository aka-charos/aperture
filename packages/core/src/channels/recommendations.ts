import { createChildLogger } from '../lib/logger.js'
import { query, queryOne } from '../lib/db.js'
import { getMovieEmbedding, embedText } from '../recommender/movies/embeddings.js'
import { getSeriesEmbedding } from '../recommender/series/embeddings.js'
import { averageEmbeddings } from '../recommender/shared/embeddings.js'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../lib/ai-provider.js'
import type { ChannelMediaType, ChannelRecommendation } from './types.js'
import { weightedRandomSample } from './utils.js'

const logger = createChildLogger('channels')

/**
 * Per-media-type wiring for the otherwise identical candidate queries. Movies and series live in
 * parallel tables with parallel embedding tables, so everything below is driven off this map
 * rather than duplicated.
 */
const MEDIA_SOURCES: Record<
  ChannelMediaType,
  { table: string; embeddingTable: 'embeddings' | 'series_embeddings'; joinColumn: string }
> = {
  movie: { table: 'movies', embeddingTable: 'embeddings', joinColumn: 'movie_id' },
  series: { table: 'series', embeddingTable: 'series_embeddings', joinColumn: 'series_id' },
}

/** Normalise the stored media_types column: unknown/empty values fall back to movie-only. */
export function parseChannelMediaTypes(raw: string[] | null | undefined): ChannelMediaType[] {
  const types = (raw ?? []).filter((t): t is ChannelMediaType => t === 'movie' || t === 'series')
  return types.length > 0 ? types : ['movie']
}

/** Movies the user has played. */
async function getWatchedMovieIds(userId: string): Promise<Set<string>> {
  const watched = await query<{ movie_id: string }>(
    'SELECT movie_id FROM watch_history WHERE user_id = $1',
    [userId]
  )
  return new Set(watched.rows.map((r) => r.movie_id))
}

/**
 * Series the user has started. Watch history is episode-level, so "watched" means at least one
 * played episode — the same rule the series recommender uses to skip shows it already knows about.
 */
async function getWatchedSeriesIds(userId: string): Promise<Set<string>> {
  const watched = await query<{ series_id: string }>(
    `SELECT DISTINCT e.series_id
     FROM watch_history wh
     JOIN episodes e ON e.id = wh.episode_id
     WHERE wh.user_id = $1 AND wh.media_type = 'episode' AND e.series_id IS NOT NULL`,
    [userId]
  )
  return new Set(watched.rows.map((r) => r.series_id))
}

interface CandidateContext {
  genreFilters: string[]
  maxParentalRating: number | null
  watchedIds: Set<string>
  poolSize: number
}

/**
 * Fetch a candidate pool for one media type, ordered by taste similarity when a taste vector is
 * available and by community rating otherwise.
 */
async function fetchCandidatePool(
  mediaType: ChannelMediaType,
  tasteProfile: number[] | null,
  modelId: string | null,
  ctx: CandidateContext
): Promise<ChannelRecommendation[]> {
  const source = MEDIA_SOURCES[mediaType]
  const whereClauses: string[] = []
  const params: unknown[] = []
  let paramIndex = 1

  // Genre filter
  if (ctx.genreFilters.length > 0) {
    whereClauses.push(`t.genres && $${paramIndex++}`)
    params.push(ctx.genreFilters)
  }

  // Parental rating filter - filter items based on user's max allowed rating
  if (ctx.maxParentalRating !== null) {
    whereClauses.push(`(
      t.content_rating IS NULL OR
      COALESCE((SELECT prv.rating_value FROM parental_rating_values prv WHERE prv.rating_name = t.content_rating LIMIT 1), 0) <= $${paramIndex++}
    )`)
    params.push(ctx.maxParentalRating)
  }

  const fetchLimit = ctx.poolSize + ctx.watchedIds.size

  if (tasteProfile && modelId) {
    const tableName = await getActiveEmbeddingTableName(source.embeddingTable)

    const embeddingWhereClauses = [...whereClauses, `e.model = $${paramIndex++}`]
    params.push(modelId)
    const embeddingWhereClause = ` WHERE ${embeddingWhereClauses.join(' AND ')}`

    const vectorStr = `[${tasteProfile.join(',')}]`
    params.push(vectorStr)

    const result = await query<{
      id: string
      provider_item_id: string
      title: string
      year: number | null
      similarity: number
    }>(
      `SELECT t.id, t.provider_item_id, t.title, t.year,
              1 - (e.embedding <=> $${paramIndex}::halfvec) as similarity
       FROM ${tableName} e
       JOIN ${source.table} t ON t.id = e.${source.joinColumn}
       ${embeddingWhereClause}
       ORDER BY e.embedding <=> $${paramIndex}::halfvec
       LIMIT $${paramIndex + 1}`,
      [...params, fetchLimit]
    )

    return result.rows
      .filter((r) => !ctx.watchedIds.has(r.id) && !!r.provider_item_id)
      .slice(0, ctx.poolSize)
      .map((r) => ({
        mediaType,
        itemId: r.id,
        providerItemId: r.provider_item_id,
        title: r.title,
        year: r.year,
        score: r.similarity,
      }))
  }

  // Fallback to rating-based ordering
  const whereClause = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : ''

  const result = await query<{
    id: string
    provider_item_id: string
    title: string
    year: number | null
    community_rating: number | null
  }>(
    `SELECT t.id, t.provider_item_id, t.title, t.year, t.community_rating
     FROM ${source.table} t
     ${whereClause}
     ORDER BY t.community_rating DESC NULLS LAST
     LIMIT $${paramIndex}`,
    [...params, fetchLimit]
  )

  return result.rows
    .filter((r) => !ctx.watchedIds.has(r.id) && !!r.provider_item_id)
    .slice(0, ctx.poolSize)
    .map((r) => ({
      mediaType,
      itemId: r.id,
      providerItemId: r.provider_item_id,
      title: r.title,
      year: r.year,
      score: r.community_rating ? Number(r.community_rating) / 10 : 0.5,
    }))
}

/**
 * Resolve a channel's seed ids into recommendation entries.
 *
 * Seeds are what the user picked by hand, so nothing is filtered here beyond needing a
 * provider item id — in particular they are NOT dropped for being watched, which is the whole
 * point of including them (a seed is usually a film the owner already loves).
 */
async function fetchSeedItems(
  movieIds: string[],
  seriesIds: string[]
): Promise<ChannelRecommendation[]> {
  const seeds: ChannelRecommendation[] = []

  for (const [mediaType, ids] of [
    ['movie', movieIds],
    ['series', seriesIds],
  ] as const) {
    if (ids.length === 0) continue

    const result = await query<{
      id: string
      provider_item_id: string | null
      title: string
      year: number | null
    }>(
      `SELECT id, provider_item_id, title, year FROM ${MEDIA_SOURCES[mediaType].table} WHERE id = ANY($1)`,
      [ids]
    )

    // Preserve the order the seeds were picked in rather than whatever the table returns.
    const byId = new Map(result.rows.map((r) => [r.id, r]))
    for (const id of ids) {
      const row = byId.get(id)
      if (!row?.provider_item_id) continue
      seeds.push({
        mediaType,
        itemId: row.id,
        providerItemId: row.provider_item_id,
        title: row.title,
        year: row.year,
        score: 1,
        isSeed: true,
      })
    }
  }

  return seeds
}

/**
 * Generate recommendations for a specific channel
 */
export async function generateChannelRecommendations(
  channelId: string,
  limit = 20
): Promise<ChannelRecommendation[]> {
  // Get channel details with owner's parental rating
  const channel = await queryOne<{
    id: string
    owner_id: string
    name: string
    genre_filters: string[]
    text_preferences: string | null
    example_movie_ids: string[]
    example_series_ids: string[] | null
    media_types: string[] | null
    include_seeds: boolean
    max_parental_rating: number | null
  }>(
    `SELECT c.*, u.max_parental_rating
     FROM channels c
     JOIN users u ON u.id = c.owner_id
     WHERE c.id = $1`,
    [channelId]
  )

  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`)
  }

  const mediaTypes = parseChannelMediaTypes(channel.media_types)

  logger.info({
    channelId,
    name: channel.name,
    mediaTypes,
    maxParentalRating: channel.max_parental_rating
  }, 'Generating channel recommendations')

  // Build channel taste profile from example movies + example series + free-text preferences.
  // All three are embedded in the same vector space and averaged together, so a channel defined
  // only by text preferences still gets a real taste vector (instead of silently falling back to
  // rating-only ordering), and a mixed-media channel is steered by both kinds of seed.
  let tasteProfile: number[] | null = null
  const embeddings: number[][] = []

  if (channel.example_movie_ids && channel.example_movie_ids.length > 0) {
    for (const movieId of channel.example_movie_ids) {
      const emb = await getMovieEmbedding(movieId)
      if (emb) {
        embeddings.push(emb)
      }
    }
  }

  if (channel.example_series_ids && channel.example_series_ids.length > 0) {
    for (const seriesId of channel.example_series_ids) {
      const emb = await getSeriesEmbedding(seriesId)
      if (emb) {
        embeddings.push(emb)
      }
    }
  }

  if (channel.text_preferences && channel.text_preferences.trim()) {
    try {
      const textEmb = await embedText(channel.text_preferences)
      if (textEmb) {
        embeddings.push(textEmb)
      }
    } catch (err) {
      logger.warn({ err, channelId }, 'Failed to embed channel text preferences; using example items only')
    }
  }

  if (embeddings.length > 0) {
    tasteProfile = averageEmbeddings(embeddings)
  }

  // Get the owner's watch history to exclude what they have already seen, per media type
  const [watchedMovieIds, watchedSeriesIds] = await Promise.all([
    mediaTypes.includes('movie') ? getWatchedMovieIds(channel.owner_id) : Promise.resolve(new Set<string>()),
    mediaTypes.includes('series') ? getWatchedSeriesIds(channel.owner_id) : Promise.resolve(new Set<string>()),
  ])

  let modelId: string | null = null
  if (tasteProfile) {
    modelId = await getActiveEmbeddingModelId()
    if (!modelId) {
      logger.warn('No embedding model configured, falling back to rating-based recommendations')
    }
  }

  // Fetch more candidates than needed (3x) to enable variety through weighted sampling
  const poolSize = limit * 3

  const pools = await Promise.all(
    mediaTypes.map((mediaType) =>
      fetchCandidatePool(mediaType, tasteProfile, modelId, {
        genreFilters: channel.genre_filters ?? [],
        maxParentalRating: channel.max_parental_rating,
        watchedIds: mediaType === 'movie' ? watchedMovieIds : watchedSeriesIds,
        poolSize,
      })
    )
  )

  // Merge the per-type pools before sampling. Scores are comparable across media types (both are
  // cosine similarity against the same taste vector, or both a normalised community rating), so a
  // mixed channel ends up weighted by actual fit instead of a fixed movie/series quota.
  const pool = pools.flat()

  // Weighted random sampling for variety
  const candidates = weightedRandomSample(pool, limit)

  // Opt-in: put the channel's own seeds in the output, ahead of the picks they inspired. They sit
  // on top of the limit rather than eating into it — the user asked for these titles by name, so
  // they should not cost the channel any recommendations.
  const seeds = channel.include_seeds
    ? await fetchSeedItems(
        mediaTypes.includes('movie') ? (channel.example_movie_ids ?? []) : [],
        mediaTypes.includes('series') ? (channel.example_series_ids ?? []) : []
      )
    : []
  const seedIds = new Set(seeds.map((s) => s.itemId))
  const result = [...seeds, ...candidates.filter((c) => !seedIds.has(c.itemId))]

  logger.info(
    {
      channelId,
      mediaTypes,
      candidateCount: result.length,
      seedCount: seeds.length,
      seriesCount: result.filter((c) => c.mediaType === 'series').length,
      topScores: candidates.slice(0, 3).map((c) => c.score.toFixed(3)),
    },
    'Generated channel recommendations with variability'
  )

  return result
}
