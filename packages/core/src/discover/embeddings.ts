/**
 * Discovery Candidate Embeddings
 *
 * A discovery candidate is by definition NOT in the library, so it has no
 * stored vector — which is why the scorer's taste-similarity term was dead (see
 * migration 0160). This module embeds candidates from their TMDb metadata and
 * caches the result, shared across every user and every run.
 *
 * THE DOCUMENT IS THINNER THAN THE LIBRARY'S, AND THAT IS FINE HERE.
 * `buildCanonicalText` writes nine sections from a library row; a candidate can
 * only fill six of them (no studios, no cinematographers, no keywords, and an
 * overview rather than a full IMDb synopsis). So candidate vectors sit
 * systematically further from the taste centroid than library vectors do.
 *
 * That matters for a THRESHOLD and not for a RANKING, and discovery only ranks:
 * every candidate is thin in the same way, so the offset is common to all of
 * them and cancels out of the comparison. What must not happen is treating a
 * discovery similarity as comparable to a recommender one, or thresholding it
 * against a constant derived from library-to-library distances.
 */

import { createHash } from 'node:crypto'
import { createChildLogger } from '../lib/logger.js'
import { query } from '../lib/db.js'
import { getEmbeddingInvocation, getActiveEmbeddingTableName } from '../lib/ai-provider.js'
import { isCenteringReady } from '../recommender/centering.js'
import type { MediaType, RawCandidate } from './types.js'

const logger = createChildLogger('discover:embeddings')

/** Candidates embedded per model call. Matches the library embedding batches. */
const EMBED_BATCH_SIZE = 50

/**
 * Ceiling on how many candidates get embedded in one run.
 *
 * Embedding is cached and shared, so the steady state is a handful of new
 * titles per run — but the FIRST run on a fresh pool would otherwise embed
 * everything at once. This spreads that cost over several runs, highest-ranked
 * first, which is also the order in which the vectors matter.
 */
const MAX_EMBEDS_PER_RUN = 400

/**
 * The canonical text for a candidate.
 *
 * Mirrors `buildCanonicalText`'s section order and labels exactly, minus the
 * fields TMDb does not give us. The labels are load-bearing: "Genres:",
 * "Directed by", "Starring" are literal shared strings in every library
 * document, so using the same ones keeps a candidate in the same register
 * rather than adding a second axis of difference on top of the missing fields.
 *
 * Pure and exported so the shape can be pinned without a database or a model.
 */
export function buildCandidateCanonicalText(
  candidate: RawCandidate,
  genreNames: string[]
): string {
  const sections: string[] = []

  // Title first, no year — matching buildCanonicalText, which deliberately
  // omits the release year so it cannot act as a literal era token.
  sections.push(candidate.title)

  if (candidate.tagline) {
    sections.push(`"${candidate.tagline}"`)
  }

  if (genreNames.length > 0) {
    sections.push(`Genres: ${genreNames.join(', ')}`)
  }

  if (candidate.directors && candidate.directors.length > 0) {
    sections.push(`Directed by ${candidate.directors.join(', ')}`)
  }

  if (candidate.castMembers && candidate.castMembers.length > 0) {
    const leads = candidate.castMembers.slice(0, 3).map((c) => c.name)
    sections.push(`Starring ${leads.join(', ')}`)
  }

  if (candidate.overview) {
    sections.push(candidate.overview)
  }

  return sections.join('\n')
}

/** Stable identity for a document, so a richer one supersedes a thinner one. */
function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

/** Parse pgvector's text form. */
function parseVector(raw: string): number[] {
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((v) => parseFloat(v))
}

/**
 * Per-run answers to the questions that do not vary by viewer.
 *
 * The unit of a discovery "run" is a JOB, not a user, and the two were being
 * confused: `runDiscoveryForUser` is called `users x 2` times, and each call
 * re-asked the library for two constants. The expensive one is the mean --
 * `AVG(l2_normalize(embedding::vector))` over 12,589 rows of 3,072 halfvec is
 * a ~77 MB read cast to ~155 MB of float4 and 38.6M additions, and on a
 * ten-viewer instance it ran twenty times a night for one number that could not
 * have changed. Neither can move mid-run: nothing inside a discovery job writes
 * an embedding or re-centres a column.
 *
 * Cleared explicitly at the start of every run rather than given a TTL, so the
 * lifetime is a fact about the code and not a guess about the clock. A stale
 * entry would centre candidates against a mean the library has moved away from,
 * which is a wrong DIRECTION rather than a wrong scale (F-036 rule 6).
 */
const libraryMeanCache = new Map<string, number[] | null>()
const centeringReadyCache = new Map<MediaType, boolean>()

/** Drop the per-run caches. Call at the start of a discovery run. */
export function clearDiscoveryRunCaches(): void {
  libraryMeanCache.clear()
  centeringReadyCache.clear()
}

/**
 * Whether the centred column is fully populated, asked once per run.
 *
 * Wraps `isCenteringReady` here rather than memoizing it in `centering.ts`,
 * because that function is shared with both recommender pipelines and the
 * embedding jobs -- which do write embeddings, and for which a cached answer
 * would be wrong.
 */
export async function isCenteringReadyForRun(mediaType: MediaType): Promise<boolean> {
  const cached = centeringReadyCache.get(mediaType)
  if (cached !== undefined) return cached

  const ready = await isCenteringReady(mediaType)
  centeringReadyCache.set(mediaType, ready)
  return ready
}

/**
 * The library mean, for putting a fresh vector into the centred space.
 *
 * `refreshCenteredEmbeddings` stores `l2_normalize(embedding) - AVG(l2_normalize(embedding))`,
 * and F-036 records that the mean is never stored because a profile built from
 * the centred column is already centred and needs none. That holds for every
 * existing reader — but a candidate vector has never been in that column, so it
 * is the one case where the mean genuinely has to be recomputed.
 *
 * Once per run and per (media type, set id) — see the cache above. The SQL is
 * form-identical to `refreshCenteredEmbeddings`' own, and filters on the same
 * string, since `getActiveEmbeddingModelId` returns `embeddingSetId(config)`.
 * Those two must stay in step or candidates are centred against a different
 * population than the library rows were.
 *
 * Returns null when there is nothing to average, which the caller treats as
 * "cannot serve the centred space" rather than falling back to raw. A null is
 * cached too: it means the set is empty, which will not change mid-run either.
 */
export async function getLibraryEmbeddingMean(
  mediaType: MediaType,
  setId: string
): Promise<number[] | null> {
  const cacheKey = `${mediaType}:${setId}`
  const cached = libraryMeanCache.get(cacheKey)
  if (cached !== undefined) return cached

  const table = await getActiveEmbeddingTableName(
    mediaType === 'movie' ? 'embeddings' : 'series_embeddings'
  )

  const result = await query<{ mean: string | null }>(
    `SELECT AVG(l2_normalize(embedding::vector))::text AS mean
       FROM ${table}
      WHERE model = $1`,
    [setId]
  )

  const raw = result.rows[0]?.mean
  const mean = raw ? parseVector(raw) : null
  libraryMeanCache.set(cacheKey, mean)
  return mean
}

/** L2-normalise, matching what centring does to a row before subtracting. */
export function l2Normalize(vector: number[]): number[] {
  let sumSquares = 0
  for (const v of vector) sumSquares += v * v
  const norm = Math.sqrt(sumSquares)
  if (norm === 0) return vector
  return vector.map((v) => v / norm)
}

/**
 * Put a freshly embedded candidate into the same space the taste vectors are in.
 *
 * Centring is a SUBTRACTION, not a rescale, so the row has to be normalised
 * first exactly as `refreshCenteredEmbeddings` does — otherwise a long vector is
 * rotated by a different amount than a short one and the result is a wrong
 * direction rather than a wrong magnitude (F-036 rule 6).
 */
export function centreVector(vector: number[], mean: number[]): number[] | null {
  if (vector.length !== mean.length) return null
  const unit = l2Normalize(vector)
  return unit.map((v, i) => v - mean[i])
}

/**
 * Vectors for these candidates, embedding and caching any that are missing.
 *
 * Returns raw (uncentred) vectors — the caller decides which space it needs,
 * because that depends on the viewer's profile rather than on the candidate.
 */
export async function getCandidateEmbeddings(
  mediaType: MediaType,
  candidates: RawCandidate[],
  genreNameFor: (id: number) => string | undefined
): Promise<Map<number, number[]>> {
  const vectors = new Map<number, number[]>()
  if (candidates.length === 0) return vectors

  const invocation = await getEmbeddingInvocation()
  const setId = invocation.setId

  // Build every document up front: the hash decides both cache hits and what
  // needs re-embedding, so it has to exist before the read.
  const documents = new Map<number, string>()
  for (const c of candidates) {
    const genreNames = (c.genres ?? [])
      .map((g) => (g.name && g.name.length > 0 ? g.name : genreNameFor(g.id)))
      .filter((n): n is string => !!n)
    documents.set(c.tmdbId, buildCandidateCanonicalText(c, genreNames))
  }

  const tmdbIds = [...documents.keys()]

  const cached = await query<{ tmdb_id: number; embedding: string; text_hash: string }>(
    `SELECT tmdb_id, embedding::text AS embedding, text_hash
       FROM discovery_candidate_embeddings
      WHERE media_type = $1 AND model = $2 AND tmdb_id = ANY($3::int[])`,
    [mediaType, setId, tmdbIds]
  )

  const cachedHash = new Map<number, string>()
  for (const row of cached.rows) {
    vectors.set(row.tmdb_id, parseVector(row.embedding))
    cachedHash.set(row.tmdb_id, row.text_hash)
  }

  // Embed what is missing, or what now has a richer document than the cached
  // vector was built from. Ordered by the candidate array, which arrives
  // score-ordered, so a capped run embeds the titles nearest the top first.
  const stale = candidates.filter((c) => {
    const hash = hashText(documents.get(c.tmdbId) ?? '')
    const previous = cachedHash.get(c.tmdbId)
    return previous !== hash
  })

  if (stale.length === 0) {
    logger.debug({ mediaType, cached: vectors.size }, 'All candidate embeddings cached')
    return vectors
  }

  const toEmbed = stale.slice(0, MAX_EMBEDS_PER_RUN)

  logger.info(
    { mediaType, setId, cached: vectors.size, stale: stale.length, embedding: toEmbed.length },
    'Embedding discovery candidates'
  )

  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + EMBED_BATCH_SIZE)
    const texts = batch.map((c) => documents.get(c.tmdbId) ?? c.title)

    let embedded: number[][]
    try {
      embedded = await invocation.embedBatch(texts)
    } catch (err) {
      // A model outage must not fail the run. The scorer treats a missing
      // vector as "no taste signal for this candidate" and falls back to a
      // neutral term, which is the same state the whole feature was in before.
      logger.warn({ err, mediaType, batchStart: i }, 'Failed to embed candidate batch')
      break
    }

    const rows: { tmdbId: number; vector: number[]; hash: string }[] = []
    batch.forEach((c, index) => {
      const vector = embedded[index]
      if (!vector || vector.length === 0) return
      vectors.set(c.tmdbId, vector)
      rows.push({
        tmdbId: c.tmdbId,
        vector,
        hash: hashText(documents.get(c.tmdbId) ?? ''),
      })
    })

    if (rows.length > 0) {
      try {
        const values: unknown[] = []
        const tuples = rows.map((r, index) => {
          const b = index * 5
          values.push(mediaType, r.tmdbId, setId, `[${r.vector.join(',')}]`, r.hash)
          return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::halfvec, $${b + 5})`
        })
        await query(
          `INSERT INTO discovery_candidate_embeddings
             (media_type, tmdb_id, model, embedding, text_hash)
           VALUES ${tuples.join(', ')}
           ON CONFLICT (media_type, tmdb_id, model) DO UPDATE SET
             embedding = EXCLUDED.embedding,
             text_hash = EXCLUDED.text_hash,
             updated_at = NOW()`,
          values
        )
      } catch (err) {
        // The vectors are already in `vectors` and will be used for this run;
        // only the cache write failed, so the next run pays again.
        logger.warn({ err, mediaType }, 'Failed to cache candidate embeddings')
      }
    }
  }

  return vectors
}

/**
 * Drop cached vectors for titles no longer in the pool.
 *
 * Runs beside `clearOldPoolEntries` for the same reason: nothing else deletes
 * from this table, and a cache that only grows is the defect the pool already
 * had.
 */
export async function clearOrphanedCandidateEmbeddings(
  mediaType: MediaType,
  olderThanDays: number
): Promise<number> {
  const result = await query(
    `DELETE FROM discovery_candidate_embeddings e
      WHERE e.media_type = $1
        AND e.updated_at < NOW() - INTERVAL '1 day' * $2::int
        AND NOT EXISTS (
          SELECT 1 FROM discovery_pool p
           WHERE p.media_type = e.media_type AND p.tmdb_id = e.tmdb_id
        )`,
    [mediaType, olderThanDays]
  )
  const deleted = result.rowCount ?? 0
  if (deleted > 0) {
    logger.info({ mediaType, deleted }, 'Cleared orphaned candidate embeddings')
  }
  return deleted
}
