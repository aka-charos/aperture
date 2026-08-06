import { createChildLogger } from '../../lib/logger.js'
import { query, queryOne } from '../../lib/db.js'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../../lib/ai-provider.js'
import type { Candidate } from '../types.js'

const logger = createChildLogger('recommender-candidates')

interface CandidateQueryContext {
  modelId: string
  tableName: string
  hasLibraryConfigs: boolean
}

/**
 * Resolves the model/table/library-config context shared by every candidate
 * query. Hoisted out of the per-vector query path so multi-cluster retrieval
 * (getMultiClusterCandidates) resolves it once, not once per cluster.
 */
async function resolveCandidateQueryContext(): Promise<CandidateQueryContext | null> {
  const modelId = await getActiveEmbeddingModelId()
  if (!modelId) {
    logger.warn('No embedding model configured for candidate generation')
    return null
  }

  const tableName = await getActiveEmbeddingTableName('embeddings')

  const configCheck = await queryOne<{ count: string }>('SELECT COUNT(*) FROM library_config')
  const hasLibraryConfigs = Boolean(configCheck && parseInt(configCheck.count, 10) > 0)

  return { modelId, tableName, hasLibraryConfigs }
}

function buildParentalFilter(maxParentalRating: number | null): string {
  return maxParentalRating !== null
    ? ` AND (m.content_rating IS NULL OR COALESCE((
        SELECT prv.rating_value FROM parental_rating_values prv
        WHERE prv.rating_name = m.content_rating LIMIT 1
      ), 0) <= ${maxParentalRating})`
    : ''
}

/**
 * Runs the actual pgvector ANN query for a single query vector, filters out
 * watched ids, and maps to Candidate[]. This exact `ORDER BY <=> LIMIT` shape
 * is what lets Postgres use the HNSW index on the embedding table -- a query
 * comparing against multiple vectors at once would not use it (see
 * getMultiClusterCandidates), so multi-centroid retrieval calls this once per
 * cluster instead of trying to fold multiple vectors into one query.
 */
async function queryCandidatesForVector(
  vectorStr: string,
  limit: number,
  includeWatched: boolean,
  watchedIds: Set<string>,
  parentalFilter: string,
  ctx: CandidateQueryContext
): Promise<Candidate[]> {
  // Calculate query limit - if excluding watched, need more results to filter from
  const queryLimit = includeWatched ? limit : limit + watchedIds.size

  // Use pgvector to find similar movies, filtered by enabled libraries, parental rating, and model
  const result = await query<{
    id: string
    title: string
    year: number | null
    genres: string[]
    community_rating: number | null
    similarity: number
  }>(
    ctx.hasLibraryConfigs
      ? `SELECT m.id, m.title, m.year, m.genres, m.community_rating,
                1 - (e.embedding <=> $1::halfvec) as similarity
         FROM ${ctx.tableName} e
         JOIN movies m ON m.id = e.movie_id
         WHERE e.model = $3 AND EXISTS (
           SELECT 1 FROM library_config lc
           WHERE lc.provider_library_id = m.provider_library_id
           AND lc.is_enabled = true
         )${parentalFilter}
         ORDER BY e.embedding <=> $1::halfvec
         LIMIT $2`
      : `SELECT m.id, m.title, m.year, m.genres, m.community_rating,
                1 - (e.embedding <=> $1::halfvec) as similarity
         FROM ${ctx.tableName} e
         JOIN movies m ON m.id = e.movie_id
         WHERE e.model = $3${parentalFilter}
         ORDER BY e.embedding <=> $1::halfvec
         LIMIT $2`,
    [vectorStr, queryLimit, ctx.modelId]
  )

  // Filter out watched movies if not including them
  const filteredRows = includeWatched
    ? result.rows
    : result.rows.filter((row) => !watchedIds.has(row.id))

  return filteredRows.slice(0, limit).map((row) => ({
    movieId: row.id,
    id: row.id, // Alias for shared selection algorithm
    title: row.title,
    year: row.year,
    genres: row.genres || [],
    communityRating: row.community_rating,
    similarity: row.similarity,
    novelty: 0,
    ratingScore: 0,
    diversityScore: 0,
    diversityBoost: 0,
    finalScore: 0,
  }))
}

export async function getCandidates(
  tasteProfile: number[],
  watchedIds: Set<string>,
  limit: number,
  includeWatched: boolean = false,
  maxParentalRating: number | null = null
): Promise<Candidate[]> {
  const ctx = await resolveCandidateQueryContext()
  if (!ctx) return []

  const vectorStr = `[${tasteProfile.join(',')}]`
  const parentalFilter = buildParentalFilter(maxParentalRating)

  return queryCandidatesForVector(vectorStr, limit, includeWatched, watchedIds, parentalFilter, ctx)
}

export interface ClusterQueryInput {
  embedding: number[]
  weight: number
}

/**
 * Merge per-cluster candidate result sets, keeping the MAX similarity for any
 * candidate id that appears in more than one cluster's results. Pure -- no DB
 * access -- independently unit-testable.
 *
 * MAX (not average) is deliberate, mirroring the "loop over N vectors, take
 * max" pattern already used for custom-interest affinity
 * (taste-profile/index.ts getCustomInterestAffinity): a candidate that's a
 * strong match for ANY one of the user's taste facets should score as a
 * strong match, full stop. Averaging would silently recreate the exact
 * "semantic middle" dilution multi-centroid retrieval exists to fix -- e.g. a
 * 0.9 match to cluster A and a 0.1 match to cluster B would average to 0.5,
 * worse than the 0.9 either alone deserves.
 */
export function mergeClusterCandidatesByMaxSimilarity(perClusterResults: Candidate[][]): Candidate[] {
  const merged = new Map<string, Candidate>()

  for (const candidates of perClusterResults) {
    for (const candidate of candidates) {
      const existing = merged.get(candidate.id)
      if (!existing || candidate.similarity > existing.similarity) {
        merged.set(candidate.id, candidate)
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.similarity - a.similarity)
}

/**
 * Multi-centroid candidate retrieval: one indexed ANN query per taste
 * cluster (see queryCandidatesForVector -- never a single query comparing
 * against multiple vectors, which would defeat the HNSW index), merged by
 * max similarity. Falls back to the single-vector getCandidates() when
 * there's only one cluster, so callers can pass whatever getUserTasteClusters
 * returned without special-casing length 1 themselves.
 */
export async function getMultiClusterCandidates(
  clusters: ClusterQueryInput[],
  watchedIds: Set<string>,
  totalLimit: number,
  includeWatched: boolean = false,
  maxParentalRating: number | null = null
): Promise<Candidate[]> {
  if (clusters.length === 0) return []
  if (clusters.length === 1) {
    return getCandidates(clusters[0].embedding, watchedIds, totalLimit, includeWatched, maxParentalRating)
  }

  const ctx = await resolveCandidateQueryContext()
  if (!ctx) return []

  const parentalFilter = buildParentalFilter(maxParentalRating)
  const { allocateClusterCandidateLimits } = await import('../shared/index.js')
  const perClusterLimits = allocateClusterCandidateLimits(
    clusters.map((c) => c.weight),
    totalLimit
  )

  const perClusterResults = await Promise.all(
    clusters.map((cluster, i) => {
      const vectorStr = `[${cluster.embedding.join(',')}]`
      return queryCandidatesForVector(
        vectorStr,
        perClusterLimits[i],
        includeWatched,
        watchedIds,
        parentalFilter,
        ctx
      )
    })
  )

  return mergeClusterCandidatesByMaxSimilarity(perClusterResults)
}
