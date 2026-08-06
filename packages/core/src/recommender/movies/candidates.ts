import { createChildLogger } from '../../lib/logger.js'
import { query, queryOne } from '../../lib/db.js'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../../lib/ai-provider.js'
import {
  buildInterestMatchIndex,
  type InterestMatchIndex,
  type InterestQueryResult,
} from '../shared/interestSlots.js'
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

/**
 * How many neighbors to pull per custom interest. Anything past this falls to
 * neutral affinity, which is what the old `<0.3 similarity` branch produced
 * anyway -- see the tail check below, which makes a too-small cap visible in
 * the logs instead of silent.
 */
export const INTEREST_ANN_LIMIT = 1000

/**
 * Upper bound on how many interests get their own query, so a user with a
 * long interest list can't turn one recommendation run into dozens of scans.
 * Interests arrive newest-first (user_custom_interests is ordered by
 * created_at DESC), so the cap drops the oldest.
 */
export const MAX_QUERIED_INTERESTS = 10

export interface InterestQueryInput {
  interestId: string
  interestText: string
  weight: number
  embedding: number[] | null
  embeddingModel: string | null
}

/**
 * One indexed ANN query per custom interest, folded into the lookup index the
 * pipeline uses for both interest affinity and reserved slots.
 *
 * This replaces a per-candidate loop that re-fetched the user's whole interest
 * list and one item embedding for every candidate it looked at -- roughly 200
 * round-trips per user per run, and capped at the top 100 candidates, so the
 * signal was simply absent for everything else. Going through
 * queryCandidatesForVector means no new SQL: the same library/parental/watched
 * filtering and the same index-friendly `ORDER BY <=> LIMIT` shape apply.
 *
 * Interests embedded with a different model are skipped rather than queried --
 * pgvector raises on a dimension mismatch, and a stale-dimension interest
 * would previously just score 0 forever via cosineSimilarity's length guard.
 * refreshCustomInterestEmbeddings (taste-profile/index.ts) re-embeds them on
 * the next profile rebuild.
 */
export async function getInterestMatchIndex(
  interests: InterestQueryInput[],
  watchedIds: Set<string>,
  includeWatched: boolean = false,
  maxParentalRating: number | null = null
): Promise<InterestMatchIndex> {
  if (interests.length === 0) return buildInterestMatchIndex([])

  const ctx = await resolveCandidateQueryContext()
  if (!ctx) return buildInterestMatchIndex([])

  const usable = interests.filter(
    (interest) =>
      interest.embedding &&
      interest.embedding.length > 0 &&
      interest.embeddingModel === ctx.modelId
  )

  const skipped = interests.length - usable.length
  if (skipped > 0) {
    logger.debug(
      { skipped, activeModel: ctx.modelId },
      'Skipped custom interests with a missing or stale-model embedding'
    )
  }

  const queried = usable.slice(0, MAX_QUERIED_INTERESTS)
  if (queried.length < usable.length) {
    logger.info(
      { total: usable.length, queried: queried.length },
      `Limiting interest matching to the ${MAX_QUERIED_INTERESTS} most recent interests`
    )
  }

  const parentalFilter = buildParentalFilter(maxParentalRating)
  const results: InterestQueryResult[] = []

  // Sequential on purpose: the interest count is user-controlled, and firing
  // one query per interest concurrently could crowd the connection pool in a
  // way the fixed K<=3 cluster queries never can.
  for (const interest of queried) {
    try {
      const vectorStr = `[${interest.embedding!.join(',')}]`
      const rows = await queryCandidatesForVector(
        vectorStr,
        INTEREST_ANN_LIMIT,
        includeWatched,
        watchedIds,
        parentalFilter,
        ctx
      )

      const tail = rows[rows.length - 1]
      if (rows.length >= INTEREST_ANN_LIMIT && tail && tail.similarity * interest.weight >= 0.3) {
        logger.debug(
          { interestText: interest.interestText, tailSimilarity: tail.similarity },
          'Interest match list hit its limit while still above the neutral threshold'
        )
      }

      results.push({
        interestId: interest.interestId,
        interestText: interest.interestText,
        weight: interest.weight,
        rows: rows.map((row) => ({ candidateId: row.id, similarity: row.similarity })),
      })
    } catch (err) {
      // One malformed interest must not cost the whole run its recommendations.
      logger.warn(
        { err, interestId: interest.interestId },
        'Custom interest match query failed, skipping this interest'
      )
    }
  }

  return buildInterestMatchIndex(results)
}
