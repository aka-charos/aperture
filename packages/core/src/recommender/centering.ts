/**
 * Mean-centred embeddings: which space a comparison happens in, and how the
 * centred column gets filled.
 *
 * Every canonical text here describes a film, in one template, in one register.
 * That shared content is a direction every vector in the library holds in
 * common, and it is a large part of what each cosine measures -- raw neighbour
 * cosines on the live library crowd into 0.66-0.83, so an excellent match sits
 * about 0.13 from a poor one. Subtracting the library mean removes the shared
 * direction. Measured by `evaluate-recommender` over 33 viewers, ndcg@100 goes
 * 20.5% -> 31.9% and recall@100 11.2% -> 20.6%, with the largest gains landing
 * on the viewers raw served worst.
 *
 * The mean is never stored or looked up at query time. The taste centroid is
 * BUILT FROM these vectors, so a profile built from the centred column is
 * already centred, and comparing it against that same column needs no mean.
 * Centring is therefore purely an ingestion concern, which is the whole reason
 * it lives in a column rather than as a `- mean` term every future query has to
 * remember to include.
 */

import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import {
  getActiveEmbeddingModelId,
  getActiveEmbeddingTableName,
} from '../lib/ai-provider.js'
import type { MediaType } from '../taste-profile/types.js'

const logger = createChildLogger('embedding-centering')

/**
 * Which space a set of vectors lives in.
 *
 * Deliberately a TypeScript union with no CHECK constraint behind it: 0144 had
 * to drop exactly that shape from `custom_ai_models` because a value list in
 * SQL is a copy no build can see, and it silently rejected two AI roles for
 * months.
 */
export type EmbeddingSpace = 'raw' | 'centered'

/** The column holding vectors for a given space. */
export function embeddingColumnFor(space: EmbeddingSpace): string {
  return space === 'centered' ? 'embedding_centered' : 'embedding'
}

/**
 * Decide which space to run a retrieval in, given the space the viewer's stored
 * taste profile was built in and whether the centred column is usable.
 *
 * THIS IS THE CORRECTNESS-CRITICAL RULE OF THE WHOLE FEATURE. A profile is
 * built once and read later, so the two sides of the comparison are resolved at
 * different times. Comparing a raw centroid against centred items (or the
 * reverse) is not "slightly worse" -- it is a cosine between two different
 * spaces, which yields a confident ranking that means nothing, and would read
 * as the recommender mysteriously degrading.
 *
 * The table, and why each row is what it is:
 *
 *   profile   centred ready   ->  result
 *   raw       no                  'raw'       both sides raw
 *   raw       yes                 'raw'       <- the safety property, see below
 *   centered  yes                 'centered'  both sides centred
 *   centered  no                  null        refuse; the profile needs a rebuild
 *
 * Row 2 is what makes the rollout safe: filling the centred column changes
 * NOTHING until a profile is rebuilt. So the migration can ship, the backfill
 * job can run, and no user's recommendations move until `rebuild-taste-profiles`
 * deliberately moves them -- and if the result is wrong, rebuilding profiles
 * from the raw column is the entire rollback.
 *
 * Row 4 returns null rather than silently falling back to raw. A centred
 * profile compared against raw items is precisely the mixed-space bug, and the
 * caller's correct response is to rebuild that profile, not to serve a ranking
 * it cannot trust.
 */
export function resolveEmbeddingSpace(
  profileSpace: EmbeddingSpace,
  centeringReady: boolean
): EmbeddingSpace | null {
  if (profileSpace === 'centered') {
    return centeringReady ? 'centered' : null
  }
  return 'raw'
}

/**
 * The space a NEW taste profile should be built in.
 *
 * Separate from `resolveEmbeddingSpace` on purpose: building is the moment a
 * user moves between spaces, and reading must never make that decision for
 * itself.
 */
export function buildSpaceFor(centeringReady: boolean): EmbeddingSpace {
  return centeringReady ? 'centered' : 'raw'
}

/**
 * Whether the centred column is fully populated for the active model.
 *
 * Deliberately all-or-nothing. A half-filled column is worse than an empty one:
 * rows with a NULL centred vector drop out of an `ORDER BY ... LIMIT` entirely,
 * so a partial backfill would quietly shrink the candidate pool to whatever
 * happened to be filled, and nothing would report an error.
 */
export async function isCenteringReady(mediaType: MediaType): Promise<boolean> {
  const modelId = await getActiveEmbeddingModelId()
  if (!modelId) return false

  const tableName = await resolveTable(mediaType)

  const row = await queryOne<{ missing: string }>(
    `SELECT COUNT(*) AS missing
       FROM ${tableName}
      WHERE model = $1 AND embedding_centered IS NULL`,
    [modelId]
  )

  return row != null && Number(row.missing) === 0
}

/**
 * Recompute the library mean and rewrite the centred column for every row of
 * the active model.
 *
 * Done as one statement so the whole column moves to a single mean. Doing it in
 * batches would leave rows centred against different means mid-run, which is
 * the mixed-space bug again in a subtler form -- every row would be non-NULL,
 * so `isCenteringReady` would report ready while the vectors disagreed about
 * where the origin is.
 *
 * The `::vector` casts are not decoration. `-` and `avg()` are defined for
 * `vector` across every pgvector build that has halfvec at all, whereas the
 * halfvec overloads arrived later; casting costs one pass over a table this job
 * is already rewriting in full.
 */
export async function refreshCenteredEmbeddings(
  mediaType: MediaType
): Promise<{ updated: number; skipped: boolean }> {
  const modelId = await getActiveEmbeddingModelId()
  if (!modelId) {
    logger.warn({ mediaType }, 'No embedding model configured; skipping centering')
    return { updated: 0, skipped: true }
  }

  const tableName = await resolveTable(mediaType)

  const result = await query(
    `WITH library_mean AS (
       SELECT AVG(embedding::vector) AS mean
         FROM ${tableName}
        WHERE model = $1
     )
     UPDATE ${tableName} AS t
        SET embedding_centered =
              (t.embedding::vector - (SELECT mean FROM library_mean))::halfvec
      WHERE t.model = $1
        AND (SELECT mean FROM library_mean) IS NOT NULL`,
    [modelId]
  )

  const updated = result.rowCount ?? 0
  logger.info({ mediaType, tableName, modelId, updated }, 'Recentred embeddings')
  return { updated, skipped: false }
}

async function resolveTable(mediaType: MediaType): Promise<string> {
  return mediaType === 'movie'
    ? await getActiveEmbeddingTableName('embeddings')
    : await getActiveEmbeddingTableName('series_embeddings')
}
