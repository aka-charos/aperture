/**
 * Discovery Storage
 * 
 * Database operations for storing discovery runs, candidates, and requests
 */

import { createChildLogger } from '../lib/logger.js'
import { query, queryOne, transaction } from '../lib/db.js'
import { PERSONALIZED_SOURCES } from './types.js'
import type {
  MediaType,
  DiscoveryRun,
  DiscoveryCandidate,
  DiscoveryRequest,
  ScoredCandidate,
  DiscoveryRunStatus,
  DiscoveryRequestStatus,
  DiscoveryRequestSource,
  DiscoveryFilterOptions,
  PoolCandidate,
  RawCandidate,
  GlobalDiscoverySource,
  PersonalizedDiscoverySource,
} from './types.js'

const logger = createChildLogger('discover:storage')

// ============================================================================
// Discovery Runs
// ============================================================================

/**
 * Create a new discovery run record
 */
export async function createDiscoveryRun(
  userId: string,
  mediaType: MediaType,
  runType: 'scheduled' | 'manual' = 'scheduled'
): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO discovery_runs (user_id, media_type, run_type, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING id`,
    [userId, mediaType, runType]
  )

  if (!result) {
    throw new Error('Failed to create discovery run')
  }

  logger.debug({ runId: result.id, userId, mediaType }, 'Created discovery run')
  return result.id
}

/**
 * Update discovery run statistics
 */
export async function updateDiscoveryRunStats(
  runId: string,
  stats: {
    candidatesFetched?: number
    candidatesFiltered?: number
    candidatesScored?: number
    candidatesStored?: number
  }
): Promise<void> {
  const updates: string[] = []
  const values: (string | number)[] = [runId]
  let paramIndex = 2

  if (stats.candidatesFetched !== undefined) {
    updates.push(`candidates_fetched = $${paramIndex}`)
    values.push(stats.candidatesFetched)
    paramIndex++
  }
  if (stats.candidatesFiltered !== undefined) {
    updates.push(`candidates_filtered = $${paramIndex}`)
    values.push(stats.candidatesFiltered)
    paramIndex++
  }
  if (stats.candidatesScored !== undefined) {
    updates.push(`candidates_scored = $${paramIndex}`)
    values.push(stats.candidatesScored)
    paramIndex++
  }
  if (stats.candidatesStored !== undefined) {
    updates.push(`candidates_stored = $${paramIndex}`)
    values.push(stats.candidatesStored)
    paramIndex++
  }

  if (updates.length === 0) return

  await query(
    `UPDATE discovery_runs SET ${updates.join(', ')} WHERE id = $1`,
    values
  )
}

/**
 * Finalize a discovery run
 */
export async function finalizeDiscoveryRun(
  runId: string,
  status: DiscoveryRunStatus,
  durationMs: number,
  errorMessage?: string
): Promise<void> {
  await query(
    `UPDATE discovery_runs 
     SET status = $2, duration_ms = $3, error_message = $4
     WHERE id = $1`,
    [runId, status, durationMs, errorMessage ?? null]
  )

  logger.debug({ runId, status, durationMs }, 'Finalized discovery run')
}

/**
 * Get the latest discovery run for a user
 */
export async function getLatestDiscoveryRun(
  userId: string,
  mediaType: MediaType
): Promise<DiscoveryRun | null> {
  const result = await queryOne<{
    id: string
    user_id: string
    media_type: MediaType
    run_type: 'scheduled' | 'manual'
    candidates_fetched: number
    candidates_filtered: number
    candidates_scored: number
    candidates_stored: number
    duration_ms: number | null
    status: DiscoveryRunStatus
    error_message: string | null
    created_at: Date
  }>(
    `SELECT * FROM discovery_runs 
     WHERE user_id = $1 AND media_type = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, mediaType]
  )

  if (!result) return null

  return {
    id: result.id,
    userId: result.user_id,
    mediaType: result.media_type,
    runType: result.run_type,
    candidatesFetched: result.candidates_fetched,
    candidatesFiltered: result.candidates_filtered,
    candidatesScored: result.candidates_scored,
    candidatesStored: result.candidates_stored,
    durationMs: result.duration_ms,
    status: result.status,
    errorMessage: result.error_message,
    createdAt: result.created_at,
  }
}

// ============================================================================
// Discovery Pool (Shared Candidates)
// ============================================================================

/** Columns bound per pool row by {@link upsertPoolCandidates}. */
const POOL_COLUMN_COUNT = 16

/** Rows per pool upsert statement. 16 columns -> 3,200 bind parameters. */
const POOL_UPSERT_CHUNK = 200

/**
 * Upsert candidates into the shared discovery pool.
 *
 * One statement per chunk via ON CONFLICT, rather than the SELECT-then-
 * UPDATE-or-INSERT round trip per candidate this used to do (~1,200 round trips
 * per media type). That form also raced: two overlapping runs could both read
 * "not present", and the loser's insert hit the unique constraint and was
 * swallowed by the catch.
 *
 * Two guards ride in the VALUES rather than the conflict clause:
 *
 * - The numeric columns are NULLIF'd to 0. Trakt's payloads carry no TMDb vote
 *   data and trakt_popular/trakt_recommendations hardcode popularity 0, so the
 *   old `COALESCE($n, existing)` -- which only guards NULL -- wrote a literal 0
 *   straight over a good rating (and over popularity, which feeds the ranking)
 *   whenever a title was seen by Trakt but had dropped out of TMDb Discover's
 *   window that run. 0 means "no data" for every writer here, so storing NULL
 *   loses nothing and lets a later sighting fill the column in.
 * - `sources` is unioned rather than replaced, preserving the merge the old
 *   read-then-write did in JavaScript. The union keeps FIRST-SEEN order, which
 *   `ARRAY(SELECT DISTINCT unnest(...))` did not: SELECT DISTINCT with no
 *   ORDER BY guarantees nothing, and `sources[1]` is what poolCandidateToRaw
 *   hands calculateSourceScore -- so a title's source score could change
 *   between runs without the title changing. The live pool held the same source
 *   set in both orders, which is that non-determinism showing up in the data.
 *
 * `popularity_source` is written in the SAME expression as `popularity` and is
 * NULL whenever the figure is, so the unit and the number cannot drift apart.
 * That pairing is the whole of migration 0162: `popularity` holds three
 * different quantities depending on who supplied it, and the scorer normalises
 * within the group the label names.
 *
 * `is_enriched` and the enrichment columns are deliberately absent: they are
 * owned by updatePoolEnrichmentBatch and a metadata refresh must not discard
 * cast and crew someone already paid to fetch.
 */
export async function upsertPoolCandidates(
  mediaType: MediaType,
  candidates: RawCandidate[]
): Promise<{ inserted: number; updated: number }> {
  if (candidates.length === 0) return { inserted: 0, updated: 0 }

  // Last write wins within a batch: ON CONFLICT cannot touch the same row twice
  // in one statement ("cannot affect row a second time").
  const deduped = [...new Map(candidates.map((c) => [c.tmdbId, c])).values()]

  let inserted = 0
  let updated = 0

  for (let start = 0; start < deduped.length; start += POOL_UPSERT_CHUNK) {
    const chunk = deduped.slice(start, start + POOL_UPSERT_CHUNK)
    const values: unknown[] = []
    const tuples: string[] = []

    chunk.forEach((c, i) => {
      const b = i * POOL_COLUMN_COUNT
      tuples.push(
        // sources is cast explicitly: in a multi-row VALUES the inference for a
        // bare array parameter is less forgiving than in the single-row insert
        // this replaced, and the failure would only appear at runtime.
        `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::text[], ` +
        `$${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, ` +
        `$${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}::jsonb, ` +
        `NULLIF($${b + 13}::numeric, 0), NULLIF($${b + 14}::integer, 0), ` +
        // The unit is claimed only when the figure is actually stored: a
        // popularity of 0 means "this source has no popularity signal", and
        // labelling an absent number would be a claim about nothing.
        `NULLIF($${b + 15}::numeric, 0), ` +
        `CASE WHEN NULLIF($${b + 15}::numeric, 0) IS NULL THEN NULL ELSE $${b + 16}::text END)`
      )
      values.push(
        mediaType, c.tmdbId, c.imdbId, [c.source],
        c.title, c.originalTitle, c.originalLanguage, c.releaseYear,
        c.posterPath, c.backdropPath, c.overview,
        JSON.stringify(c.genres || []),
        c.voteAverage, c.voteCount, c.popularity,
        c.popularitySource ?? c.source
      )
    })

    try {
      // xmax = 0 distinguishes a fresh insert from a conflict update; it is
      // only used for the log line.
      const res = await query<{ inserted: boolean }>(
        `INSERT INTO discovery_pool (
           media_type, tmdb_id, imdb_id, sources,
           title, original_title, original_language, release_year,
           poster_path, backdrop_path, overview,
           genres, vote_average, vote_count, popularity, popularity_source
         ) VALUES ${tuples.join(', ')}
         ON CONFLICT (media_type, tmdb_id) DO UPDATE SET
           -- Append-only, so the existing order survives untouched and
           -- sources[1] stays whichever source saw this title first. The
           -- previous form, ARRAY(SELECT DISTINCT unnest(...)), reordered the
           -- whole array on every write: SELECT DISTINCT with no ORDER BY
           -- guarantees nothing, and the live pool held the same source set in
           -- both orders as a result.
           sources = discovery_pool.sources || ARRAY(
             SELECT s FROM unnest(EXCLUDED.sources) AS s
              WHERE NOT (s = ANY(discovery_pool.sources))
           ),
           imdb_id = COALESCE(EXCLUDED.imdb_id, discovery_pool.imdb_id),
           title = COALESCE(NULLIF(EXCLUDED.title, ''), discovery_pool.title),
           original_title = COALESCE(EXCLUDED.original_title, discovery_pool.original_title),
           original_language = COALESCE(EXCLUDED.original_language, discovery_pool.original_language),
           release_year = COALESCE(EXCLUDED.release_year, discovery_pool.release_year),
           poster_path = COALESCE(EXCLUDED.poster_path, discovery_pool.poster_path),
           backdrop_path = COALESCE(EXCLUDED.backdrop_path, discovery_pool.backdrop_path),
           overview = COALESCE(NULLIF(EXCLUDED.overview, ''), discovery_pool.overview),
           genres = CASE WHEN EXCLUDED.genres != '[]'::jsonb THEN EXCLUDED.genres ELSE discovery_pool.genres END,
           vote_average = COALESCE(EXCLUDED.vote_average, discovery_pool.vote_average),
           vote_count = COALESCE(EXCLUDED.vote_count, discovery_pool.vote_count),
           popularity = COALESCE(EXCLUDED.popularity, discovery_pool.popularity),
           -- Moves with the number, never independently. This is the pairing
           -- migration 0162 exists to enforce: whichever source's figure won
           -- above is the source whose unit the column is now in.
           popularity_source = CASE
             WHEN EXCLUDED.popularity IS NOT NULL THEN EXCLUDED.popularity_source
             ELSE discovery_pool.popularity_source
           END,
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        values
      )

      for (const row of res.rows) {
        if (row.inserted) inserted++
        else updated++
      }
    } catch (err) {
      logger.warn(
        { err, mediaType, chunkStart: start, chunkSize: chunk.length },
        'Failed to upsert pool candidate chunk'
      )
    }
  }

  logger.info({ mediaType, inserted, updated, total: deduped.length }, 'Upserted pool candidates')
  return { inserted, updated }
}

/**
 * Candidates from the pool for a media type, newest-relevant first.
 *
 * Bounded on purpose. Nothing in a global fetch removes a title, so the pool
 * only grows -- an unbounded read made every run slower than the last, drove
 * the popularity normalisation's cost, and merged progressively staler titles
 * into every user's candidate list. `limit` keeps the popularity-ordered head
 * and drops the tail; `maxAgeDays` drops rows no global fetch has re-seen in
 * that long, matching what the prune sweep deletes so a read never returns
 * rows that are about to disappear.
 *
 * Both are optional so an admin/diagnostic caller can still ask for everything.
 */
export async function getPoolCandidates(
  mediaType: MediaType,
  options: { limit?: number; maxAgeDays?: number } = {}
): Promise<PoolCandidate[]> {
  const result = await query<{
    id: string
    media_type: MediaType
    tmdb_id: number
    imdb_id: string | null
    title: string
    original_title: string | null
    original_language: string | null
    release_year: number | null
    poster_path: string | null
    backdrop_path: string | null
    overview: string | null
    genres: { id: number; name: string }[]
    vote_average: string | null
    vote_count: number | null
    popularity: string | null
    popularity_source: string | null
    cast_members: { id: number; name: string; character: string; profilePath: string | null }[] | null
    directors: string[] | null
    runtime_minutes: number | null
    tagline: string | null
    is_enriched: boolean
    sources: string[]
    created_at: Date
    updated_at: Date
  }>(
    // ORDER BY decides which rows SURVIVE the LIMIT, so it must be a quantity
    // every row shares. `popularity DESC NULLS LAST` was not: the column holds
    // TMDb's metric, a Trakt watcher count and NULL for a source with no
    // popularity signal at all (migration 0162), so once the pool outgrew
    // maxPoolCandidates the cap stopped being a bound and became a filter --
    // dropping every Trakt-only title first, then the least globally popular.
    //
    // That last part is the one worth naming: this is a cap for a list scored
    // IN MEMORY per viewer, a resource bound and not a quality judgement, and
    // ranking is what the scorer exists to do afterwards. Truncating by global
    // popularity removes the niche title that best matches one person's taste
    // before it can ever be scored -- on the feature whose whole purpose is
    // personalization, with similarity carrying more of the blend than
    // popularity does.
    //
    // `updated_at` is a unit every row shares: how recently a source last
    // offered this title. It is not an ideal answer -- a whole night's batch
    // shares a timestamp, so within a batch it decides nothing -- but it is an
    // honest one, and it cannot fragment the way a mixed unit does. The
    // tmdb_id tiebreak makes truncation deterministic; without it Postgres may
    // order ties freely and which rows survive would vary between runs, which
    // is the defect 0162 just removed from `sources`.
    //
    // Inert when measured (279 movies, 263 series against a cap of 3,000), and
    // changed anyway: the trigger is an admin raising poolMaxAgeDays, and by
    // then nobody remembers the column holds three units.
    `SELECT * FROM discovery_pool
     WHERE media_type = $1
       ${options.maxAgeDays != null ? `AND updated_at >= NOW() - INTERVAL '1 day' * $2::int` : ''}
     ORDER BY updated_at DESC, tmdb_id ASC
     ${options.limit != null ? `LIMIT $${options.maxAgeDays != null ? 3 : 2}` : ''}`,
    [
      mediaType,
      ...(options.maxAgeDays != null ? [options.maxAgeDays] : []),
      ...(options.limit != null ? [options.limit] : []),
    ]
  )

  return result.rows.map(row => ({
    id: row.id,
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    imdbId: row.imdb_id,
    title: row.title,
    originalTitle: row.original_title,
    originalLanguage: row.original_language,
    releaseYear: row.release_year,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    overview: row.overview,
    genres: row.genres || [],
    voteAverage: row.vote_average ? parseFloat(row.vote_average) : null,
    voteCount: row.vote_count,
    popularity: row.popularity ? parseFloat(row.popularity) : null,
    popularitySource: (row.popularity_source as GlobalDiscoverySource | null) ?? null,
    castMembers: row.cast_members,
    directors: row.directors,
    runtimeMinutes: row.runtime_minutes,
    tagline: row.tagline,
    isEnriched: row.is_enriched,
    sources: row.sources as GlobalDiscoverySource[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

/**
 * Write full-enrichment metadata back onto the pool rows for these candidates,
 * so the next user's run can skip the lookup.
 *
 * This is the half of the pool that was built and never wired up: the columns,
 * `is_enriched`, and a single-row updater all existed, but nothing
 * called them, so every user independently re-fetched details + credits for the
 * same overlapping set of popular titles -- by far the largest external cost in
 * the job.
 *
 * Deliberately UPDATE-only, keyed on (media_type, tmdb_id). A candidate from a
 * personalized source has no pool row and must not gain one: `sources` is
 * NOT NULL and typed as global-only sources, so inserting here would corrupt
 * what the pool means. Those candidates simply go unenriched-cached, which is
 * correct -- they are per-user by nature.
 *
 * A candidate carrying no cast is skipped rather than written as enriched: a
 * lookup that came back empty is not a lookup worth caching, and marking it
 * done would freeze a blank card in place for every future user.
 *
 * It writes the DISPLAY fields too, not only cast and crew. The same TMDb
 * response carried `vote_average`, `vote_count`, the poster, the backdrop, the
 * overview, the original language and the real genre list, and dropping them
 * meant a pool row that a run had already paid to enrich kept its blank rating
 * forever -- so the missing-rating gap could not heal itself, and every user in
 * every future run paid the same lookup while the pool never learned the
 * answer. The numeric pair is `NULLIF`'d to 0 for the reason the upsert does
 * the same: on this table NULL is "no vote data" and 0 would be a claim.
 */
export async function updatePoolEnrichmentBatch(
  mediaType: MediaType,
  candidates: RawCandidate[]
): Promise<number> {
  const enrichable = candidates.filter((c) => c.castMembers && c.castMembers.length > 0)
  if (enrichable.length === 0) return 0

  let updated = 0

  try {
    await transaction(async (client) => {
      for (const c of enrichable) {
        const res = await client.query(
          `UPDATE discovery_pool SET
             cast_members = $3::jsonb,
             directors = COALESCE($4::text[], directors),
             runtime_minutes = COALESCE($5::integer, runtime_minutes),
             tagline = COALESCE($6::text, tagline),
             imdb_id = COALESCE($7::text, imdb_id),
             vote_average = COALESCE(NULLIF($8::numeric, 0), vote_average),
             vote_count = COALESCE(NULLIF($9::integer, 0), vote_count),
             poster_path = COALESCE($10::text, poster_path),
             backdrop_path = COALESCE($11::text, backdrop_path),
             overview = COALESCE(NULLIF($12::text, ''), overview),
             original_language = COALESCE($13::text, original_language),
             genres = CASE WHEN $14::jsonb <> '[]'::jsonb THEN $14::jsonb ELSE genres END,
             is_enriched = TRUE,
             updated_at = NOW()
           WHERE media_type = $1 AND tmdb_id = $2`,
          [
            mediaType,
            c.tmdbId,
            JSON.stringify(c.castMembers ?? []),
            c.directors && c.directors.length > 0 ? c.directors : null,
            c.runtimeMinutes ?? null,
            c.tagline ?? null,
            c.imdbId ?? null,
            c.voteAverage || null,
            c.voteCount || null,
            c.posterPath ?? null,
            c.backdropPath ?? null,
            c.overview ?? null,
            c.originalLanguage ?? null,
            JSON.stringify(c.genres ?? []),
          ]
        )
        updated += res.rowCount ?? 0
      }
    })
  } catch (err) {
    // Caching is an optimisation. The run has already paid for this metadata
    // and stored it on the user's own candidate rows, so a failure here must
    // not fail the run -- it just means the next user pays again.
    logger.warn({ err, mediaType, count: enrichable.length }, 'Failed to cache pool enrichment')
    return 0
  }

  logger.info(
    { mediaType, offered: candidates.length, cached: updated },
    'Cached full enrichment onto pool rows'
  )
  return updated
}

/**
 * Clear old pool entries (for maintenance)
 */
export async function clearOldPoolEntries(
  mediaType: MediaType,
  olderThanDays: number = 30
): Promise<number> {
  // $2 is cast explicitly: `INTERVAL * $2` on its own leaves the parameter's
  // type for Postgres to infer from the multiply operator, which it can refuse
  // outright ("could not determine data type of parameter").
  const result = await query(
    `DELETE FROM discovery_pool
     WHERE media_type = $1 AND updated_at < NOW() - INTERVAL '1 day' * $2::int`,
    [mediaType, olderThanDays]
  )

  logger.info({ mediaType, deleted: result.rowCount, olderThanDays }, 'Cleared old pool entries')
  return result.rowCount ?? 0
}

/**
 * Convert pool candidate to raw candidate format for scoring
 */
export function poolCandidateToRaw(pool: PoolCandidate): RawCandidate {
  return {
    tmdbId: pool.tmdbId,
    imdbId: pool.imdbId,
    title: pool.title,
    originalTitle: pool.originalTitle,
    originalLanguage: pool.originalLanguage,
    overview: pool.overview,
    releaseYear: pool.releaseYear,
    posterPath: pool.posterPath,
    backdropPath: pool.backdropPath,
    genres: pool.genres,
    voteAverage: pool.voteAverage ?? 0,
    voteCount: pool.voteCount ?? 0,
    popularity: pool.popularity ?? 0,
    // The unit travels with the number. `sources[0]` answers a different
    // question -- which source's RECOMMENDATION this is, for
    // calculateSourceScore -- and a pool row's array records every source that
    // ever offered the title, not the one whose popularity figure is stored.
    // Reading the unit off it filed TMDb-scaled values in a group of Trakt ones
    // and normalised them to 1.0 (migration 0162).
    popularitySource: pool.popularitySource ?? undefined,
    source: pool.sources[0] || 'tmdb_discover', // Use first source
    castMembers: pool.castMembers ?? undefined,
    directors: pool.directors ?? undefined,
    runtimeMinutes: pool.runtimeMinutes,
    tagline: pool.tagline,
    // Carried so enrichMissingData can skip a row a previous run already paid
    // to enrich. Without this the pool's cached cast/crew was loaded and then
    // re-fetched anyway.
    isEnriched: pool.isEnriched,
    poolId: pool.id,
  }
}

// ============================================================================
// Discovery Candidates
// ============================================================================

/**
 * Store discovery candidates (upsert to handle duplicates)
 */
/** Columns bound per candidate row by {@link storeDiscoveryCandidates}. */
const CANDIDATE_COLUMN_COUNT = 31

/**
 * Rows per INSERT statement.
 *
 * Postgres caps a statement at 65,535 bind parameters. At 29 columns the full
 * default set (maxTotalCandidates 1000) is 29,000 -- under the ceiling, but a
 * single statement that large is needlessly close to it and would break the
 * moment either number grew. 200 rows is 5,800 parameters, and all the chunks
 * commit together.
 */
const CANDIDATE_INSERT_CHUNK = 200

export async function storeDiscoveryCandidates(
  runId: string,
  userId: string,
  candidates: ScoredCandidate[],
  mediaType: MediaType
): Promise<number> {
  if (candidates.length === 0) return 0

  // Delete and insert in ONE transaction. Previously the DELETE was committed
  // on its own and then up to 1,000 single-row INSERTs followed, each with a
  // catch that logged and continued -- so a crash, a restart, or the HTTP
  // timeout on the manual-refresh path left the user with a half-populated or
  // completely empty Discover page and no way to tell that had happened.
  // Rolling back to the previous candidate set is strictly better than
  // presenting a truncated one as complete.
  const stored = await transaction(async (client) => {
    await client.query(
      `DELETE FROM discovery_candidates WHERE user_id = $1 AND media_type = $2`,
      [userId, mediaType]
    )

    let inserted = 0

    for (let start = 0; start < candidates.length; start += CANDIDATE_INSERT_CHUNK) {
      const chunk = candidates.slice(start, start + CANDIDATE_INSERT_CHUNK)
      const values: unknown[] = []
      const tuples: string[] = []

      chunk.forEach((c, offsetInChunk) => {
        const base = offsetInChunk * CANDIDATE_COLUMN_COUNT
        tuples.push(
          `(${Array.from({ length: CANDIDATE_COLUMN_COUNT }, (_, k) => `$${base + k + 1}`).join(', ')})`
        )
        values.push(
          runId, userId, mediaType, c.tmdbId, c.imdbId, start + offsetInChunk + 1,
          c.finalScore, c.similarityScore, c.popularityScore, c.recencyScore, c.sourceScore,
          c.source, c.sourceMediaId ?? null,
          c.title, c.originalTitle, c.originalLanguage ?? null, c.releaseYear,
          c.posterPath, c.backdropPath, c.overview,
          JSON.stringify(c.genres),
          c.voteAverage, c.voteCount, JSON.stringify(c.scoreBreakdown),
          JSON.stringify(c.castMembers ?? []),
          c.directors ?? [],
          c.runtimeMinutes ?? null,
          c.tagline ?? null,
          c.isEnriched ?? false,
          // Both added by migration 0098 and never written until now, so
          // pool_id was always NULL and is_personalized always FALSE.
          // is_personalized is the only stored signal that separates "picked
          // for you" from "trending everywhere".
          c.poolId ?? null,
          PERSONALIZED_SOURCES.includes(c.source as PersonalizedDiscoverySource)
        )
      })

      const res = await client.query(
        `INSERT INTO discovery_candidates (
          run_id, user_id, media_type, tmdb_id, imdb_id, rank,
          final_score, similarity_score, popularity_score, recency_score, source_score,
          source, source_media_id,
          title, original_title, original_language, release_year,
          poster_path, backdrop_path, overview,
          genres, vote_average, vote_count, score_breakdown,
          cast_members, directors, runtime_minutes, tagline,
          is_enriched, pool_id, is_personalized
        ) VALUES ${tuples.join(', ')}`,
        values
      )
      inserted += res.rowCount ?? chunk.length
    }

    return inserted
  })

  logger.info({ runId, userId, mediaType, stored, total: candidates.length }, 'Stored discovery candidates')
  return stored
}

/**
 * Get discovery candidates for a user with real-time library filtering
 */
export async function getDiscoveryCandidates(
  userId: string,
  mediaType: MediaType,
  options: DiscoveryFilterOptions = {}
): Promise<DiscoveryCandidate[]> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0

  // Build dynamic WHERE clause for filters
  const conditions: string[] = ['dc.user_id = $1', 'dc.media_type = $2']
  const params: (string | number | string[])[] = [userId, mediaType]
  let paramIndex = 3

  // Real-time library exclusion - exclude items that are now in the library
  // This fixes the bug where items added after discovery generation still appear
  const libraryTable = mediaType === 'movie' ? 'movies' : 'series'
  conditions.push(`NOT EXISTS (
    SELECT 1 FROM ${libraryTable} lib WHERE lib.tmdb_id = dc.tmdb_id::text
  )`)

  // Language filter
  if (options.languages && options.languages.length > 0) {
    // Default to including unknown language content when filtering
    const includeUnknown = options.includeUnknownLanguage !== false
    if (includeUnknown) {
      conditions.push(`(dc.original_language = ANY($${paramIndex}::text[]) OR dc.original_language IS NULL)`)
    } else {
      conditions.push(`dc.original_language = ANY($${paramIndex}::text[])`)
    }
    params.push(options.languages)
    paramIndex++
  }

  // Genre filter - check if any of the requested genres exist in the genres JSONB array
  if (options.genreIds && options.genreIds.length > 0) {
    // Use JSONB containment to check if any genre ID matches
    const genreConditions = options.genreIds.map((_: number, i: number) => 
      `dc.genres @> $${paramIndex + i}::jsonb`
    )
    conditions.push(`(${genreConditions.join(' OR ')})`)
    for (const genreId of options.genreIds) {
      params.push(JSON.stringify([{ id: genreId }]))
      paramIndex++
    }
  }

  // Year range filter
  if (options.yearStart !== undefined) {
    conditions.push(`dc.release_year >= $${paramIndex}`)
    params.push(options.yearStart)
    paramIndex++
  }
  if (options.yearEnd !== undefined) {
    conditions.push(`dc.release_year <= $${paramIndex}`)
    params.push(options.yearEnd)
    paramIndex++
  }

  // Minimum similarity threshold filter
  if (options.minSimilarity !== undefined && options.minSimilarity > 0) {
    conditions.push(`dc.similarity_score >= $${paramIndex}`)
    params.push(options.minSimilarity)
    paramIndex++
  }

  // Add pagination params
  params.push(limit, offset)

  const result = await query<{
    id: string
    run_id: string
    user_id: string
    media_type: MediaType
    tmdb_id: number
    imdb_id: string | null
    rank: number
    final_score: string
    similarity_score: string | null
    popularity_score: string | null
    recency_score: string | null
    source_score: string | null
    source: string
    source_media_id: number | null
    title: string
    original_title: string | null
    original_language: string | null
    release_year: number | null
    poster_path: string | null
    backdrop_path: string | null
    overview: string | null
    genres: { id: number; name: string }[]
    vote_average: string | null
    vote_count: number | null
    score_breakdown: Record<string, number>
    cast_members: { id: number; name: string; character: string; profilePath: string | null }[] | null
    directors: string[] | null
    runtime_minutes: number | null
    tagline: string | null
    is_enriched: boolean
    created_at: Date
  }>(
    `SELECT dc.* FROM discovery_candidates dc
     WHERE ${conditions.join(' AND ')}
     ORDER BY dc.rank ASC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  )

  return result.rows.map(row => ({
    id: row.id,
    runId: row.run_id,
    userId: row.user_id,
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    imdbId: row.imdb_id,
    rank: row.rank,
    finalScore: parseFloat(row.final_score),
    similarityScore: row.similarity_score ? parseFloat(row.similarity_score) : null,
    popularityScore: row.popularity_score ? parseFloat(row.popularity_score) : null,
    recencyScore: row.recency_score ? parseFloat(row.recency_score) : null,
    sourceScore: row.source_score ? parseFloat(row.source_score) : null,
    source: row.source as DiscoveryCandidate['source'],
    sourceMediaId: row.source_media_id,
    title: row.title,
    originalTitle: row.original_title,
    originalLanguage: row.original_language,
    releaseYear: row.release_year,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    overview: row.overview,
    genres: row.genres,
    voteAverage: row.vote_average ? parseFloat(row.vote_average) : null,
    voteCount: row.vote_count,
    scoreBreakdown: row.score_breakdown,
    castMembers: row.cast_members || [],
    directors: row.directors || [],
    runtimeMinutes: row.runtime_minutes,
    tagline: row.tagline,
    isEnriched: row.is_enriched ?? true, // Default to true for backwards compatibility
    createdAt: row.created_at,
  }))
}

/**
 * Get count of discovery candidates for a user with real-time library filtering
 */
export async function getDiscoveryCandidateCount(
  userId: string,
  mediaType: MediaType,
  options: Omit<DiscoveryFilterOptions, 'limit' | 'offset'> = {}
): Promise<number> {
  // Build dynamic WHERE clause for filters (same logic as getDiscoveryCandidates)
  const conditions: string[] = ['dc.user_id = $1', 'dc.media_type = $2']
  const params: (string | number | string[])[] = [userId, mediaType]
  let paramIndex = 3

  // Real-time library exclusion
  const libraryTable = mediaType === 'movie' ? 'movies' : 'series'
  conditions.push(`NOT EXISTS (
    SELECT 1 FROM ${libraryTable} lib WHERE lib.tmdb_id = dc.tmdb_id::text
  )`)

  // Language filter
  if (options.languages && options.languages.length > 0) {
    // Default to including unknown language content when filtering
    const includeUnknown = options.includeUnknownLanguage !== false
    if (includeUnknown) {
      conditions.push(`(dc.original_language = ANY($${paramIndex}::text[]) OR dc.original_language IS NULL)`)
    } else {
      conditions.push(`dc.original_language = ANY($${paramIndex}::text[])`)
    }
    params.push(options.languages)
    paramIndex++
  }

  // Genre filter
  if (options.genreIds && options.genreIds.length > 0) {
    const genreConditions = options.genreIds.map((_: number, i: number) => 
      `dc.genres @> $${paramIndex + i}::jsonb`
    )
    conditions.push(`(${genreConditions.join(' OR ')})`)
    for (const genreId of options.genreIds) {
      params.push(JSON.stringify([{ id: genreId }]))
      paramIndex++
    }
  }

  // Year range filter
  if (options.yearStart !== undefined) {
    conditions.push(`dc.release_year >= $${paramIndex}`)
    params.push(options.yearStart)
    paramIndex++
  }
  if (options.yearEnd !== undefined) {
    conditions.push(`dc.release_year <= $${paramIndex}`)
    params.push(options.yearEnd)
    paramIndex++
  }

  // Minimum similarity threshold filter
  if (options.minSimilarity !== undefined && options.minSimilarity > 0) {
    conditions.push(`dc.similarity_score >= $${paramIndex}`)
    params.push(options.minSimilarity)
    paramIndex++
  }

  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM discovery_candidates dc
     WHERE ${conditions.join(' AND ')}`,
    params
  )

  return parseInt(result?.count ?? '0', 10)
}

/**
 * Clear discovery candidates for a user
 */
export async function clearDiscoveryCandidates(
  userId: string,
  mediaType?: MediaType
): Promise<number> {
  let result
  if (mediaType) {
    result = await query(
      `DELETE FROM discovery_candidates WHERE user_id = $1 AND media_type = $2`,
      [userId, mediaType]
    )
  } else {
    result = await query(
      `DELETE FROM discovery_candidates WHERE user_id = $1`,
      [userId]
    )
  }

  logger.info({ userId, mediaType, deleted: result.rowCount }, 'Cleared discovery candidates')
  return result.rowCount ?? 0
}

// ============================================================================
// Discovery Requests
// ============================================================================

/**
 * Create a discovery request record
 */
export async function createDiscoveryRequest(
  userId: string,
  mediaType: MediaType,
  tmdbId: number,
  title: string,
  discoveryCandidateId?: string,
  source: DiscoveryRequestSource = 'discovery'
): Promise<string> {
  // Validate that the discovery candidate exists before linking
  // (candidates may be cleaned up during refresh, but we still want to allow the request)
  let validCandidateId: string | null = null
  if (discoveryCandidateId) {
    const candidate = await queryOne<{ id: string }>(
      `SELECT id FROM discovery_candidates WHERE id = $1`,
      [discoveryCandidateId]
    )
    if (candidate) {
      validCandidateId = discoveryCandidateId
    } else {
      logger.warn({ discoveryCandidateId }, 'Discovery candidate not found, proceeding without link')
    }
  }

  const result = await queryOne<{ id: string }>(
    `INSERT INTO discovery_requests (
      user_id, media_type, tmdb_id, title, discovery_candidate_id, status, source
    ) VALUES ($1, $2, $3, $4, $5, 'pending', $6)
    RETURNING id`,
    [userId, mediaType, tmdbId, title, validCandidateId, source]
  )

  if (!result) {
    throw new Error('Failed to create discovery request')
  }

  logger.info({ requestId: result.id, userId, mediaType, tmdbId, title }, 'Created discovery request')
  return result.id
}

/**
 * Update a discovery request status
 */
export async function updateDiscoveryRequestStatus(
  requestId: string,
  status: DiscoveryRequestStatus,
  options: {
    seerrRequestId?: number
    seerrMediaId?: number
    statusMessage?: string
  } = {}
): Promise<void> {
  await query(
    `UPDATE discovery_requests 
     SET status = $2,
         seerr_request_id = COALESCE($3, seerr_request_id),
         seerr_media_id = COALESCE($4, seerr_media_id),
         status_message = COALESCE($5, status_message)
     WHERE id = $1`,
    [
      requestId,
      status,
      options.seerrRequestId ?? null,
      options.seerrMediaId ?? null,
      options.statusMessage ?? null,
    ]
  )

  logger.info({ requestId, status }, 'Updated discovery request status')
}

/**
 * The WHERE fragment both the count and the page share.
 *
 * One builder rather than two copies, because the count and the list have to
 * describe the same population — a "12 requests" header over a table of 9 is
 * a bug report, and the two predicates drift the moment they are written
 * twice. `userId === null` means every user, which is the admin scope.
 */
function buildRequestFilter(
  userId: string | null,
  options: {
    mediaType?: MediaType
    status?: DiscoveryRequestStatus
    source?: DiscoveryRequestSource
  }
): { where: string; params: (string | number)[]; nextIndex: number } {
  const clauses: string[] = []
  const params: (string | number)[] = []
  let i = 1

  if (userId !== null) {
    clauses.push(`r.user_id = $${i}`)
    params.push(userId)
    i++
  }
  if (options.mediaType) {
    clauses.push(`r.media_type = $${i}`)
    params.push(options.mediaType)
    i++
  }
  if (options.status) {
    clauses.push(`r.status = $${i}`)
    params.push(options.status)
    i++
  }
  if (options.source) {
    clauses.push(`r.source = $${i}`)
    params.push(options.source)
    i++
  }

  return {
    where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    params,
    nextIndex: i,
  }
}

/**
 * Count discovery requests (same filters as getDiscoveryRequests, no limit/offset).
 *
 * `userId` of null counts every user's requests — the admin scope.
 */
export async function countDiscoveryRequests(
  userId: string | null,
  options: {
    mediaType?: MediaType
    status?: DiscoveryRequestStatus
    source?: DiscoveryRequestSource
  } = {}
): Promise<number> {
  const filter = buildRequestFilter(userId, options)
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM discovery_requests r${filter.where}`,
    filter.params
  )
  return row?.c ?? 0
}

/**
 * Get discovery requests.
 *
 * `userId` of null returns every user's requests — the admin scope. The
 * requester's name is joined in rather than resolved by a second query per
 * row, since the admin view renders it on every line.
 */
export async function getDiscoveryRequests(
  userId: string | null,
  options: {
    mediaType?: MediaType
    status?: DiscoveryRequestStatus
    source?: DiscoveryRequestSource
    limit?: number
    offset?: number
  } = {}
): Promise<DiscoveryRequest[]> {
  const filter = buildRequestFilter(userId, options)
  const params = [...filter.params]
  let paramIndex = filter.nextIndex

  let sql =
    `SELECT r.*, u.username AS requested_by_username, u.display_name AS requested_by_display_name
     FROM discovery_requests r
     LEFT JOIN users u ON u.id = r.user_id` +
    filter.where +
    ` ORDER BY r.created_at DESC`

  if (options.limit != null) {
    sql += ` LIMIT $${paramIndex}`
    params.push(options.limit)
    paramIndex++
  }
  if (options.offset != null && options.offset > 0) {
    sql += ` OFFSET $${paramIndex}`
    params.push(options.offset)
  }

  const result = await query<{
    id: string
    user_id: string
    media_type: MediaType
    tmdb_id: number
    title: string
    seerr_request_id: number | null
    seerr_media_id: number | null
    status: DiscoveryRequestStatus
    status_message: string | null
    discovery_candidate_id: string | null
    source: DiscoveryRequestSource
    created_at: Date
    updated_at: Date
    requested_by_username: string | null
    requested_by_display_name: string | null
  }>(sql, params)

  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    title: row.title,
    seerrRequestId: row.seerr_request_id,
    seerrMediaId: row.seerr_media_id,
    status: row.status,
    statusMessage: row.status_message,
    discoveryCandidateId: row.discovery_candidate_id,
    source: row.source ?? 'discovery',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requestedByUsername: row.requested_by_username,
    requestedByDisplayName: row.requested_by_display_name,
  }))
}

/**
 * Check if a request already exists for a TMDb ID
 */
export async function hasExistingRequest(
  userId: string,
  tmdbId: number,
  mediaType: MediaType
): Promise<DiscoveryRequest | null> {
  const result = await queryOne<{
    id: string
    user_id: string
    media_type: MediaType
    tmdb_id: number
    title: string
    seerr_request_id: number | null
    seerr_media_id: number | null
    status: DiscoveryRequestStatus
    status_message: string | null
    discovery_candidate_id: string | null
    source: DiscoveryRequestSource
    created_at: Date
    updated_at: Date
  }>(
    `SELECT * FROM discovery_requests 
     WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, tmdbId, mediaType]
  )

  if (!result) return null

  return {
    id: result.id,
    userId: result.user_id,
    mediaType: result.media_type,
    tmdbId: result.tmdb_id,
    title: result.title,
    seerrRequestId: result.seerr_request_id,
    seerrMediaId: result.seerr_media_id,
    status: result.status,
    statusMessage: result.status_message,
    discoveryCandidateId: result.discovery_candidate_id,
    source: result.source ?? 'discovery',
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  }
}

