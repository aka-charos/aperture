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
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { createChildLogger } from '../lib/logger.js'
import { addLog, setJobStep } from '../jobs/progress.js'
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
  const state = await inspectCentering(mediaType)
  return state != null && state.missing === 0
}

/**
 * The centred column's current shape for the active model: how many rows it
 * holds and how many of them are uncentred.
 *
 * One scan rather than two. The gate needs both numbers and `isCenteringReady`
 * needs one of them, and asking separately meant two sequential COUNTs over the
 * same rows every time an embedding job finished.
 *
 * Null means no embedding model is configured, which is not the same as an
 * empty set and must not read as "ready".
 */
export async function inspectCentering(
  mediaType: MediaType
): Promise<{ modelId: string; rows: number; missing: number } | null> {
  const modelId = await getActiveEmbeddingModelId()
  if (!modelId) return null

  const tableName = await resolveTable(mediaType)

  const row = await queryOne<{ rows: string; missing: string }>(
    `SELECT COUNT(*) AS rows,
            COUNT(*) FILTER (WHERE embedding_centered IS NULL) AS missing
       FROM ${tableName}
      WHERE model = $1`,
    [modelId]
  )
  if (row == null) return null

  return { modelId, rows: Number(row.rows), missing: Number(row.missing) }
}

/**
 * What the centred column looked like the last time it was successfully
 * rewritten, so the gate can notice rows leaving.
 *
 * Keyed by model because a set switch is not drift: switching to a previously
 * centred set would otherwise compare its row count against a different set's,
 * and fire a full rewrite for nothing.
 */
const CENTERING_STATE_KEY = 'embedding_centering_state'

type CentringState = Partial<Record<MediaType, { modelId: string; rows: number }>>

async function readCentringState(): Promise<CentringState> {
  const raw = await getSystemSetting(CENTERING_STATE_KEY)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as CentringState) : {}
  } catch {
    // A corrupt blob must read as "unknown", which the gate treats as needing
    // work — never as a row count that happens to match.
    logger.warn({ key: CENTERING_STATE_KEY }, 'Centring state did not parse; treating as unknown')
    return {}
  }
}

async function writeCentringState(
  mediaType: MediaType,
  modelId: string,
  rows: number
): Promise<void> {
  const next = { ...(await readCentringState()), [mediaType]: { modelId, rows } }
  await setSystemSetting(
    CENTERING_STATE_KEY,
    JSON.stringify(next),
    'Rows per media type at the last successful centring, so deletions can be detected'
  )
}

/**
 * Whether the centred column has to be rewritten after an embedding pass.
 *
 * Pure, exported and pinned, because both embedding jobs ask it and a drift
 * between them is invisible: one media type would quietly stop being servable
 * for centred profiles while the other kept working.
 *
 * Why it is conditional at all. Rewriting the column is a full-table UPDATE
 * -- ~77 MB for 12,589 movies at 3072 halfvec -- and both embedding jobs run
 * on a six-hour interval that usually finds nothing new. Doing it
 * unconditionally would rewrite the whole table four times a day to produce
 * byte-identical vectors, for the autovacuum churn and WAL volume of a real
 * change.
 *
 * Why each condition earns its place:
 *
 *   generated > 0   New rows land with `embedding_centered` NULL, which alone
 *                   makes `isCenteringReady` false and every centred profile
 *                   refuse. They also move the mean, so the rest of the column
 *                   is now centred against a stale one.
 *
 *   !ready          Repairs a set left half-centred -- an interrupted refresh,
 *                   a failure last run, or rows written before this became
 *                   automatic. This is what makes a failed centring
 *                   self-healing rather than permanent: the next scheduled
 *                   pass sees an unready column and retries without anyone
 *                   noticing it broke.
 *
 *   row count moved Rows can LEAVE without leaving a NULL behind. Every
 *                   embedding table declares `REFERENCES movies(id) ON DELETE
 *                   CASCADE` (0007, 0030, 0078), so a title removed from the
 *                   media server takes its vector with it on the next sync.
 *                   Nothing was generated and nothing is NULL, so the two
 *                   conditions above both say no — while the mean the whole
 *                   column is centred against still counts the deleted films.
 *                   The drift scales with the fraction removed: noise for a
 *                   handful, real for a library section.
 *
 * An UNKNOWN previous count (`null`) reads as needing work. That costs one
 * rewrite on an instance upgrading into this check, and the alternative is to
 * trust a column whose history we cannot see — the asymmetry runs the same way
 * as everywhere else here, since a redundant rewrite is minutes and a stale
 * mean is silent for as long as nobody re-embeds.
 *
 * Takes an object rather than four positionals: the two counts are both
 * numbers, transposing them would still typecheck, and it forces every call
 * site to be revisited when the shape changes.
 */
export function centeringNeeded(input: {
  generated: number
  ready: boolean
  rows: number
  centredRows: number | null
}): boolean {
  const { generated, ready, rows, centredRows } = input
  return generated > 0 || !ready || centredRows == null || centredRows !== rows
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
 * is already rewriting in full. `l2_normalize` is applied to the same cast for
 * the same reason (both arrived in pgvector 0.7.0, which this schema already
 * requires -- 0024 and 0078 use halfvec, 0091 uses binary_quantize).
 *
 * ## Why the rows are normalised first
 *
 * Centring is a SUBTRACTION, and that makes it the odd one out. All 31 vector
 * comparisons in this repo use `<=>`, which is cosine and therefore
 * magnitude-invariant, so a non-unit stored vector costs them nothing and
 * nothing on the read path has ever had to care. Subtracting a shared mean is
 * different, and it fails twice over: `AVG` weights each row by its norm, so a
 * long vector pulls the library mean toward itself; and subtracting a fixed
 * vector from rows of differing magnitude moves each one by a different
 * proportion of itself, so the results differ in DIRECTION, not merely in
 * scale. Cosine cannot recover from that -- the centred column would be a
 * confident set of wrong angles.
 *
 * `storeEmbeddings` normalises nothing; it stores what the provider returned.
 * On this instance that is currently harmless, and measurably so -- norms over
 * `embeddings_3072` span 0.999930 to 1.000079 around an average of exactly
 * 1.000000, which is halfvec rounding of a vector that was unit-length when
 * written. gemini-embedding-001 at its native 3072 returns unit vectors, so
 * `l2_normalize` here is the identity to far below halfvec precision and this
 * change cannot move the current column.
 *
 * It stops being the identity the moment the vectors are not native. For any
 * one model at most one entry in `VALID_EMBEDDING_DIMENSIONS` is its native
 * width and the rest are MRL truncations, where the norm depends on how much of
 * that text's energy happened to land in the kept dimensions -- Google's own
 * documentation says non-3072 dimensions must be normalised manually. (Do not
 * restate that as a count of the list; it went stale the first time a width was
 * added.)
 *
 * A native width is no guarantee either, and two catalogue models say so
 * outright. Qwen3-Embedding's reference usage applies `F.normalize` after
 * pooling, leaving it to the caller; pplx-embed-v1-4b is served int8-quantised
 * and its model card describes what it returns as unnormalised in as many
 * words. So this is a latent defect on the current schema rather than a new
 * requirement, and it fires on a configuration an operator can already select
 * today.
 *
 * This is the same argument `buildWeightedAverageEmbedding` makes for
 * unit-normalising each item before it sums them. That was the first place
 * vectors are added rather than compared; this is the second, and it was
 * missed.
 *
 * Normalising HERE rather than in `storeEmbeddings` is deliberate. This job is
 * idempotent and already re-run on demand, so the fix repairs existing rows
 * with no re-embed; writing normalised vectors instead would leave old and new
 * rows in different states until a full pass, and would discard what the
 * provider actually returned, which is the only ground truth available when a
 * model is behaving oddly.
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
       SELECT AVG(l2_normalize(embedding::vector)) AS mean
         FROM ${tableName}
        WHERE model = $1
     )
     UPDATE ${tableName} AS t
        SET embedding_centered =
              (l2_normalize(t.embedding::vector) - (SELECT mean FROM library_mean))::halfvec
      WHERE t.model = $1
        AND (SELECT mean FROM library_mean) IS NOT NULL`,
    [modelId]
  )

  const updated = result.rowCount ?? 0
  // Recorded HERE rather than at the one caller that gates, because the manual
  // refresh-embedding-centering job calls this directly: bookkeeping attached
  // to the gate would leave that path writing a correct column and a stale
  // count, and the next embedding pass would redo the whole rewrite.
  await writeCentringState(mediaType, modelId, updated)
  logger.info({ mediaType, tableName, modelId, updated }, 'Recentred embeddings')
  return { updated, skipped: false }
}


/**
 * Re-centre after writing vectors, so a centred taste profile stays servable.
 *
 * This runs inside the embedding job rather than after it in the executor,
 * because the job owns its own progress record and calls `completeJob` itself
 * -- centring afterwards would run against a job already reported finished,
 * with the work outside both the progress bar and the recorded duration.
 *
 * One home for both embedding jobs rather than a copy in each. The movie and
 * series pipelines are mirrored by design, but this is error handling rather
 * than pipeline logic, and a copy that drifts here fails silently: one media
 * type stops being servable for centred profiles while the other keeps working.
 *
 * It never rethrows. The embeddings are written and good by this point, so
 * failing the job would report the wrong thing -- and `centeringNeeded` picks
 * it up on the next pass because the column is still unready, which is the
 * whole reason that second condition exists.
 */
export async function centreAfterGeneration(
  jobId: string,
  mediaType: MediaType,
  generated: number,
  stepIndex: number
): Promise<void> {
  try {
    const current = await inspectCentering(mediaType)
    if (current == null) {
      addLog(jobId, 'warn', '⚠️ No embedding model configured; centred column left alone')
      return
    }

    // Only the count recorded for THIS model counts as a previous observation.
    // A set switch leaves the other set's number behind, and comparing across
    // sets would fire a full rewrite that changes nothing.
    const previous = (await readCentringState())[mediaType]
    const centredRows = previous?.modelId === current.modelId ? previous.rows : null

    if (
      !centeringNeeded({
        generated,
        ready: current.missing === 0,
        rows: current.rows,
        centredRows,
      })
    ) {
      return
    }

    setJobStep(jobId, stepIndex, 'Centring embeddings')
    if (generated === 0 && current.missing === 0 && centredRows != null) {
      // Worth naming: this is the deletion path, and it is the one case where
      // the column looked complete and was still wrong.
      addLog(
        jobId,
        'info',
        `🧭 ${centredRows - current.rows} ${mediaType} embeddings have gone since the last centring; recomputing the mean...`
      )
    } else {
      addLog(jobId, 'info', '🧭 Recomputing the library mean and re-centring...')
    }

    const { updated, skipped } = await refreshCenteredEmbeddings(mediaType)
    if (skipped) {
      addLog(jobId, 'warn', '⚠️ No embedding model configured; centred column left alone')
      return
    }
    addLog(jobId, 'info', `✅ Re-centred ${updated} ${mediaType} embeddings`)
  } catch (err) {
    logger.error({ err, jobId, mediaType }, 'Failed to re-centre embeddings')
    addLog(
      jobId,
      'error',
      '❌ Re-centring failed. Centred taste profiles will refuse until it succeeds — ' +
        'the next embedding pass retries automatically, or run refresh-embedding-centering now.'
    )
  }
}

async function resolveTable(mediaType: MediaType): Promise<string> {
  return mediaType === 'movie'
    ? await getActiveEmbeddingTableName('embeddings')
    : await getActiveEmbeddingTableName('series_embeddings')
}
