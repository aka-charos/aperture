import { createChildLogger } from '../../lib/logger.js'
import { query } from '../../lib/db.js'
import {
  binderFor,
  libraryScopeSql,
  loadConfiguredLibraries,
  resolveLibraryScope,
  type LibraryScope,
} from '../../lib/libraryScope.js'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../../lib/ai-provider.js'
import type { Candidate } from '../types.js'
import { embeddingColumnFor, type EmbeddingSpace } from '../centering.js'

const logger = createChildLogger('recommender-candidates')

interface CandidateQueryContext {
  modelId: string
  tableName: string
  /**
   * What a caller that passed no viewer scope is limited to: the libraries the
   * operator enabled, no parental ceiling — exactly what this query applied to
   * everyone before viewer scope existed.
   */
  defaultScope: LibraryScope
  /**
   * Which column holds the vectors this query compares against. Resolved from
   * the SPACE THE VIEWER'S STORED PROFILE WAS BUILT IN, never decided here --
   * see recommender/centering.ts. Comparing a raw centroid against centred
   * items yields a confident ranking between two different origins.
   */
  embeddingColumn: string
}

/**
 * Resolves the model/table/library-config context shared by every candidate
 * query. Hoisted out of the per-vector query path so multi-cluster retrieval
 * (getMultiClusterCandidates) resolves it once, not once per cluster.
 */
async function resolveCandidateQueryContext(
  space: EmbeddingSpace
): Promise<CandidateQueryContext | null> {
  const modelId = await getActiveEmbeddingModelId()
  if (!modelId) {
    logger.warn('No embedding model configured for candidate generation')
    return null
  }

  const tableName = await getActiveEmbeddingTableName('embeddings')

  const defaultScope = resolveLibraryScope({
    libraries: await loadConfiguredLibraries(),
    userLibraryIds: null,
    maxParentalRating: null,
  })

  return { modelId, tableName, defaultScope, embeddingColumn: embeddingColumnFor(space) }
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
  scope: LibraryScope | null,
  ctx: CandidateQueryContext
): Promise<Candidate[]> {
  // Calculate query limit - if excluding watched, need more results to filter from
  const queryLimit = includeWatched ? limit : limit + watchedIds.size

  // Use pgvector to find similar movies, filtered by the viewer's scope (the
  // libraries the media server lets them see and the operator enabled, and their
  // parental rating) and by model.
  const params: unknown[] = [vectorStr, queryLimit, ctx.modelId]
  const inScope = libraryScopeSql(scope ?? ctx.defaultScope, 'm', binderFor(params))
  const result = await query<{
    id: string
    title: string
    year: number | null
    genres: string[]
    community_rating: number | null
    imdb_vote_count: number | null
    similarity: number
  }>(
    `SELECT m.id, m.title, m.year, m.genres, m.community_rating, m.imdb_vote_count,
            1 - (e.${ctx.embeddingColumn} <=> $1::halfvec) as similarity
     FROM ${ctx.tableName} e
     JOIN movies m ON m.id = e.movie_id
     WHERE e.model = $3 AND ${inScope}
     ORDER BY e.${ctx.embeddingColumn} <=> $1::halfvec
     LIMIT $2`,
    params
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
    voteCount: row.imdb_vote_count,
    similarity: row.similarity,
    // Filled in by scoreCandidates, which needs the whole pool to set the scale.
    normalizedSimilarity: 0,
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
  /** What this viewer may be shown; null limits to the operator's libraries only. */
  scope: LibraryScope | null = null,
  /**
   * Must match the space `tasteProfile` was built in. Defaults to 'raw' so a
   * caller that has not thought about it gets today's behaviour rather than a
   * cross-space comparison; the pipeline resolves it explicitly through
   * resolveEmbeddingSpace and refuses the run if the two cannot be reconciled.
   */
  space: EmbeddingSpace = 'raw'
): Promise<Candidate[]> {
  const ctx = await resolveCandidateQueryContext(space)
  if (!ctx) return []

  const vectorStr = `[${tasteProfile.join(',')}]`

  return queryCandidatesForVector(vectorStr, limit, includeWatched, watchedIds, scope, ctx)
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
 * MAX (not average) is deliberate: a candidate that's a strong match for ANY
 * one of the user's taste facets should score as a strong match, full stop. Averaging would silently recreate the exact
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
  scope: LibraryScope | null = null,
  space: EmbeddingSpace = 'raw'
): Promise<Candidate[]> {
  if (clusters.length === 0) return []
  if (clusters.length === 1) {
    return getCandidates(clusters[0].embedding, watchedIds, totalLimit, includeWatched, scope, space)
  }

  const ctx = await resolveCandidateQueryContext(space)
  if (!ctx) return []

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
        scope,
        ctx
      )
    })
  )

  return mergeClusterCandidatesByMaxSimilarity(perClusterResults)
}
