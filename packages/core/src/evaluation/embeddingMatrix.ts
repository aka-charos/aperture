/**
 * The whole embedding table, in memory, as one normalised matrix.
 *
 * Both instruments in this module need to rank every title against a query
 * vector, repeatedly — the neighbour dump does it once per seed, the evaluation
 * once per viewer. Doing that in SQL means one full scan per query; doing it
 * here means one scan total and then pure arithmetic.
 *
 * Rows are L2-normalised at load, so cosine similarity is a plain dot product
 * and nothing downstream has to remember to divide.
 *
 * Size: 12,584 films at 1536 dimensions is ~77 MB as Float32, which is fine for
 * a manually-triggered diagnostic and would not be for anything on a request
 * path. Nothing here belongs on a request path.
 */

import { query } from '../lib/db.js'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../lib/ai-provider.js'
import { createChildLogger } from '../lib/logger.js'

const logger = createChildLogger('evaluation-matrix')

/** Rows per round trip. Bounds peak string memory while parsing. */
const FETCH_CHUNK = 1000

export interface LibraryMatrix {
  /** Row order; index i of `ids` is row i of `data`. */
  ids: string[]
  index: Map<string, number>
  dims: number
  /** Row-major, every row L2-normalised. */
  data: Float32Array
  /**
   * Whether the library mean has been subtracted from every row.
   *
   * Carried on the matrix rather than tracked by the caller, because a centred
   * and an uncentred matrix are indistinguishable by inspection and mixing them
   * silently produces a comparison of nothing.
   */
  centered: boolean
  /**
   * The mean that was subtracted, present only when `centered`.
   *
   * Load-bearing, and easy to get wrong: a query vector has to be centred with
   * THIS mean, not with the mean of the centred matrix — which is near zero and
   * would leave the query living in a different space from the rows. The
   * ranking would still come out, and it would be meaningless.
   */
  mean?: Float32Array
}

function parseVector(text: string, into: Float32Array, offset: number, dims: number): boolean {
  // "[0.1,0.2,...]" — sliced rather than JSON.parsed, which would allocate an
  // array of 1536 boxed numbers per row.
  let cursor = text.charCodeAt(0) === 91 /* [ */ ? 1 : 0
  const end = text.charCodeAt(text.length - 1) === 93 /* ] */ ? text.length - 1 : text.length

  for (let d = 0; d < dims; d++) {
    if (cursor >= end) return false
    let comma = text.indexOf(',', cursor)
    if (comma === -1 || comma > end) comma = end
    const value = Number(text.slice(cursor, comma))
    if (!Number.isFinite(value)) return false
    into[offset + d] = value
    cursor = comma + 1
  }
  return true
}

function normaliseRow(data: Float32Array, offset: number, dims: number): boolean {
  let sum = 0
  for (let d = 0; d < dims; d++) sum += data[offset + d] * data[offset + d]
  if (!(sum > 0)) return false

  const inverse = 1 / Math.sqrt(sum)
  for (let d = 0; d < dims; d++) data[offset + d] *= inverse
  return true
}

/**
 * Load every embedding for a media type.
 *
 * Deliberately does not filter by enabled library or parental rating. This is a
 * measuring instrument: the pool it ranks over must be the same every run, or
 * two configurations are being compared over two different libraries.
 */
export async function loadLibraryMatrix(
  mediaType: 'movie' | 'series'
): Promise<LibraryMatrix | null> {
  const modelId = await getActiveEmbeddingModelId()
  if (!modelId) {
    logger.warn('No embedding model configured')
    return null
  }

  const tableName = await getActiveEmbeddingTableName(
    mediaType === 'movie' ? 'embeddings' : 'series_embeddings'
  )
  const idColumn = mediaType === 'movie' ? 'movie_id' : 'series_id'

  const countRow = await query<{ total: string; dims: string }>(
    `SELECT COUNT(*) AS total, MAX(vector_dims(embedding::vector)) AS dims
       FROM ${tableName} WHERE model = $1`,
    [modelId]
  )
  const total = Number(countRow.rows[0]?.total ?? 0)
  const dims = Number(countRow.rows[0]?.dims ?? 0)
  if (total === 0 || dims === 0) {
    logger.warn({ tableName, modelId }, 'No embeddings to load')
    return null
  }

  const ids: string[] = []
  const index = new Map<string, number>()
  const data = new Float32Array(total * dims)

  let written = 0
  for (let offset = 0; offset < total; offset += FETCH_CHUNK) {
    const chunk = await query<{ id: string; embedding: string }>(
      `SELECT ${idColumn} AS id, embedding::text AS embedding
         FROM ${tableName}
        WHERE model = $1
        ORDER BY ${idColumn}
        LIMIT $2 OFFSET $3`,
      [modelId, FETCH_CHUNK, offset]
    )

    for (const row of chunk.rows) {
      const base = written * dims
      if (!parseVector(row.embedding, data, base, dims)) continue
      if (!normaliseRow(data, base, dims)) continue
      index.set(row.id, written)
      ids.push(row.id)
      written++
    }
  }

  logger.info({ mediaType, rows: written, dims, tableName }, 'Loaded embedding matrix')

  return {
    ids,
    index,
    dims,
    // Trim if any row failed to parse, so `ids.length * dims === data.length`.
    data: written === total ? data : data.slice(0, written * dims),
    centered: false,
  }
}

/**
 * The average direction of the whole library.
 *
 * Every canonical text shares the same scaffolding — `Genres: … Directed by …
 * Starring … Keywords: … From …` — and every synopsis shares the vocabulary of
 * synopses. That common content becomes a large shared vector component, which
 * is most of why item-to-item cosines on a real library sit in a band a few
 * points wide, and why the three "closest titles in your library" for a pick
 * come back tied to the decimal.
 */
export function libraryMean(matrix: LibraryMatrix): Float32Array {
  const { dims, data, ids } = matrix
  const mean = new Float32Array(dims)
  if (ids.length === 0) return mean

  for (let row = 0; row < ids.length; row++) {
    const base = row * dims
    for (let d = 0; d < dims; d++) mean[d] += data[base + d]
  }
  for (let d = 0; d < dims; d++) mean[d] /= ids.length

  return mean
}

/**
 * Subtract the library mean from every row and renormalise.
 *
 * The point is to stop measuring the thing every film has in common — being a
 * film, described by this template — and start measuring what distinguishes
 * them. This instance has already seen the effect once from the other
 * direction: taste-profile centroids span 0.898-0.993 raw and 0.578-0.305 once
 * mean-centred, a roughly fourfold decompression, recorded at the time as a
 * live option that was never taken up.
 *
 * Returns a NEW matrix. Both are wanted at once for a comparison, and 2x77 MB
 * is a cheaper problem than accidentally reusing a mutated one.
 */
export function meanCenter(matrix: LibraryMatrix): LibraryMatrix {
  if (matrix.centered) return matrix

  const { dims, ids } = matrix
  const mean = libraryMean(matrix)
  const data = new Float32Array(matrix.data.length)

  let dropped = 0
  for (let row = 0; row < ids.length; row++) {
    const base = row * dims
    for (let d = 0; d < dims; d++) data[base + d] = matrix.data[base + d] - mean[d]
    // A row sitting exactly on the mean has no direction left. Vanishingly
    // unlikely with real data, and it must not become NaN if it happens.
    if (!normaliseRow(data, base, dims)) dropped++
  }
  if (dropped > 0) logger.warn({ dropped }, 'Rows collapsed to the library mean')

  return { ids, index: matrix.index, dims, data, centered: true, mean }
}

/**
 * Project an arbitrary vector into the matrix's space, normalising it.
 *
 * Every query — a taste centroid, a seed film — must go through here rather
 * than being compared raw, because a centred matrix needs a centred query and
 * nothing about the two shapes reveals the mismatch.
 */
export function prepareQuery(vector: number[], matrix: LibraryMatrix): Float32Array | null {
  if (vector.length !== matrix.dims) return null

  const vec = new Float32Array(matrix.dims)
  for (let d = 0; d < matrix.dims; d++) vec[d] = vector[d]

  if (matrix.centered && matrix.mean) {
    for (let d = 0; d < matrix.dims; d++) vec[d] -= matrix.mean[d]
  }

  return normaliseRow(vec, 0, matrix.dims) ? vec : null
}

/**
 * A row of the matrix, ready to use as a query.
 *
 * Rows of a centred matrix are already centred and normalised, so this is a
 * copy rather than a re-projection — running them through prepareQuery would
 * subtract the mean a second time.
 */
export function rowAsQuery(matrix: LibraryMatrix, itemId: string): Float32Array | null {
  const row = matrix.index.get(itemId)
  if (row === undefined) return null

  const base = row * matrix.dims
  return matrix.data.slice(base, base + matrix.dims)
}

/** Cosine of every row against `queryVector`, written into `out`. */
export function scoreAll(
  matrix: LibraryMatrix,
  queryVector: Float32Array,
  out: Float64Array
): void {
  const { dims, ids, data } = matrix
  for (let row = 0; row < ids.length; row++) {
    const base = row * dims
    let dot = 0
    for (let d = 0; d < dims; d++) dot += data[base + d] * queryVector[d]
    out[row] = dot
  }
}

/** A weighted mean of rows, normalised — the same shape as a taste centroid. */
export function weightedCentroid(
  matrix: LibraryMatrix,
  weightedIds: Array<{ itemId: string; weight: number }>
): Float32Array | null {
  const centroid = new Float32Array(matrix.dims)
  let used = 0

  for (const { itemId, weight } of weightedIds) {
    if (!(weight > 0)) continue
    const row = matrix.index.get(itemId)
    if (row === undefined) continue

    const base = row * matrix.dims
    for (let d = 0; d < matrix.dims; d++) centroid[d] += matrix.data[base + d] * weight
    used++
  }

  if (used === 0) return null
  return normaliseRow(centroid, 0, matrix.dims) ? centroid : null
}
