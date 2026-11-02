/**
 * MDBList Metadata Enrichment
 *
 * Enriches movies and series with data from MDBList:
 * - Letterboxd ratings
 * - MDBList aggregated scores
 * - Rotten Tomatoes critic/audience scores (supplement to OMDb)
 * - Metacritic scores (supplement to OMDb)
 * - Streaming providers (informational)
 * - Keywords
 *
 * PERFORMANCE:
 * - Uses batch API (up to 100 items per request)
 * - Respects rate limits (free: ~1k/day, supporter: higher)
 */

import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import {
  createJobProgress,
  updateJobProgress,
  setJobStep,
  completeJob,
  failJob,
  isJobCancelled,
  addLog,
} from '../jobs/progress.js'
import {
  getMDBListConfig,
  getMediaInfoByTmdbBatchOrThrow,
  getMediaInfoByImdb,
  getMediaInfoByImdbOrThrow,
  extractEnrichmentData,
} from './provider.js'
import { MDBLIST_PENDING_SQL } from './rules.js'
import type { MDBListEnrichmentData } from './types.js'

const logger = createChildLogger('mdblist:enrichment')

// ============================================================================
// Constants
// ============================================================================

/** Batch size for MDBList API (max 100) */
const BATCH_SIZE = 100

/** Number of items to fetch per database query */
const DB_BATCH_SIZE = 500

/** Requests MDBList may fail in a row before a run stops. */
const MAX_FAILED_BATCHES_IN_ROW = 3

// ============================================================================
// Types
// ============================================================================

interface MDBListEnrichmentProgress {
  moviesProcessed: number
  moviesEnriched: number
  moviesFailed: number
  seriesProcessed: number
  seriesEnriched: number
  seriesFailed: number
}

interface ItemToEnrich {
  id: string
  title: string
  tmdb_id: string | null
  imdb_id: string | null
}

// ============================================================================
// Movie Enrichment
// ============================================================================

/**
 * Titles due for MDBList (MDBLIST_PENDING_SQL): never asked first, then the
 * oldest answers; TMDB ids before IMDB-only. `skipIds` are titles a batch
 * left unstamped this run (a failed request or write), so they cannot be
 * selected again and spin the loop; they are retried next run.
 */
async function getItemsNeedingMDBListEnrichment(
  table: 'movies' | 'series',
  skipIds: string[],
  limit: number = 500
): Promise<ItemToEnrich[]> {
  const result = await query<ItemToEnrich>(
    `SELECT id, title, tmdb_id, imdb_id
     FROM ${table}
     WHERE ${MDBLIST_PENDING_SQL}
       AND NOT (id = ANY($2::uuid[]))
     ORDER BY
       mdblist_enriched_at ASC NULLS FIRST,
       CASE WHEN tmdb_id IS NOT NULL THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT $1`,
    [limit, skipIds]
  )
  return result.rows
}

async function countItemsNeedingMDBListEnrichment(table: 'movies' | 'series'): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${MDBLIST_PENDING_SQL}`
  )
  return parseInt(row?.count || '0', 10)
}


// ============================================================================
// Batch Processing (Optimized with unnest)
// ============================================================================

interface EnrichmentUpdate {
  id: string
  letterboxdScore: number | null
  mdblistScore: number | null
  rtCriticScore: number | null
  rtAudienceScore: number | null
  metacriticScore: number | null
  streamingProviders: string // JSON string
  keywords: string[] | null
}

/**
 * Bulk update movies with MDBList enrichment data using unnest()
 * OPTIMIZED: Single query updates all items instead of N individual queries
 * 
 * Note: Keywords are passed as JSON arrays and converted back to text[] in SQL
 * because unnest() doesn't handle text[][] well with COALESCE
 */
async function bulkUpdateMovies(updates: EnrichmentUpdate[]): Promise<number> {
  if (updates.length === 0) return 0

  try {
    const result = await query(
      `UPDATE movies SET
        letterboxd_score = COALESCE(data.letterboxd_score, movies.letterboxd_score),
        mdblist_score = COALESCE(data.mdblist_score, movies.mdblist_score),
        rt_critic_score = COALESCE(data.rt_critic_score, movies.rt_critic_score),
        rt_audience_score = COALESCE(data.rt_audience_score, movies.rt_audience_score),
        metacritic_score = COALESCE(data.metacritic_score, movies.metacritic_score),
        streaming_providers = COALESCE(data.streaming_providers, movies.streaming_providers),
        mdblist_keywords = COALESCE(
          (SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(data.keywords_json) AS x),
          movies.mdblist_keywords
        ),
        mdblist_enriched_at = NOW()
      FROM (
        SELECT * FROM unnest(
          $1::uuid[], $2::real[], $3::real[], $4::real[], $5::real[],
          $6::real[], $7::jsonb[], $8::jsonb[]
        ) AS t(id, letterboxd_score, mdblist_score, rt_critic_score, rt_audience_score,
               metacritic_score, streaming_providers, keywords_json)
      ) AS data
      WHERE movies.id = data.id`,
      [
        updates.map((u) => u.id),
        updates.map((u) => u.letterboxdScore),
        updates.map((u) => u.mdblistScore),
        updates.map((u) => u.rtCriticScore),
        updates.map((u) => u.rtAudienceScore),
        updates.map((u) => u.metacriticScore),
        updates.map((u) => u.streamingProviders),
        updates.map((u) => u.keywords ? JSON.stringify(u.keywords) : null),
      ]
    )
    return result.rowCount || 0
  } catch (err) {
    logger.error({ err }, 'Bulk movie update failed')
    return 0
  }
}

/**
 * Bulk update series with MDBList enrichment data using unnest()
 * OPTIMIZED: Single query updates all items instead of N individual queries
 * 
 * Note: Keywords are passed as JSON arrays and converted back to text[] in SQL
 * because unnest() doesn't handle text[][] well with COALESCE
 */
async function bulkUpdateSeries(updates: EnrichmentUpdate[]): Promise<number> {
  if (updates.length === 0) return 0

  try {
    const result = await query(
      `UPDATE series SET
        letterboxd_score = COALESCE(data.letterboxd_score, series.letterboxd_score),
        mdblist_score = COALESCE(data.mdblist_score, series.mdblist_score),
        rt_critic_score = COALESCE(data.rt_critic_score, series.rt_critic_score),
        rt_audience_score = COALESCE(data.rt_audience_score, series.rt_audience_score),
        metacritic_score = COALESCE(data.metacritic_score, series.metacritic_score),
        streaming_providers = COALESCE(data.streaming_providers, series.streaming_providers),
        mdblist_keywords = COALESCE(
          (SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(data.keywords_json) AS x),
          series.mdblist_keywords
        ),
        mdblist_enriched_at = NOW()
      FROM (
        SELECT * FROM unnest(
          $1::uuid[], $2::real[], $3::real[], $4::real[], $5::real[],
          $6::real[], $7::jsonb[], $8::jsonb[]
        ) AS t(id, letterboxd_score, mdblist_score, rt_critic_score, rt_audience_score,
               metacritic_score, streaming_providers, keywords_json)
      ) AS data
      WHERE series.id = data.id`,
      [
        updates.map((u) => u.id),
        updates.map((u) => u.letterboxdScore),
        updates.map((u) => u.mdblistScore),
        updates.map((u) => u.rtCriticScore),
        updates.map((u) => u.rtAudienceScore),
        updates.map((u) => u.metacriticScore),
        updates.map((u) => u.streamingProviders),
        updates.map((u) => u.keywords ? JSON.stringify(u.keywords) : null),
      ]
    )
    return result.rowCount || 0
  } catch (err) {
    logger.error({ err }, 'Bulk series update failed')
    return 0
  }
}

/**
 * Mark items as processed (no data found) in bulk. False when the write
 * failed, so the caller knows these titles are still unstamped.
 */
async function markAsProcessed(ids: string[], table: 'movies' | 'series'): Promise<boolean> {
  if (ids.length === 0) return true

  try {
    const result = await query(
      `UPDATE ${table} SET mdblist_enriched_at = NOW() WHERE id = ANY($1::uuid[])`,
      [ids]
    )
    logger.debug({ table, ids: ids.length, updated: result.rowCount }, 'Marked items as processed')
    return true
  } catch (err) {
    logger.error({ err, table, ids }, 'Failed to mark items as processed')
    return false
  }
}

interface BatchResult {
  enriched: number
  /** Titles MDBList answered without an entry for. */
  notFound: number
  /** The batch request itself went unanswered. */
  requestFailed: boolean
  /**
   * Titles this batch left unstamped (a request or a write failed). They are
   * still due, so the run must skip them or select them again forever; every
   * other title in the batch was stamped and is no longer due.
   */
  unstampedIds: string[]
}

/**
 * Process a batch of items (movies or series) with MDBList data
 * Uses TMDB IDs when available, falls back to IMDB
 *
 * OPTIMIZED: Uses bulk UPDATE with unnest() instead of individual queries
 */
async function processBatch(
  items: ItemToEnrich[],
  mediaType: 'movie' | 'show',
  table: 'movies' | 'series'
): Promise<BatchResult> {
  const result: BatchResult = { enriched: 0, notFound: 0, requestFailed: false, unstampedIds: [] }

  // Separate items by ID type
  const tmdbItems = items.filter((item) => item.tmdb_id !== null)
  const imdbOnlyItems = items.filter((item) => item.tmdb_id === null && item.imdb_id !== null)

  // Create maps for quick lookup by item ID
  const infoByItemId = new Map<string, MDBListEnrichmentData>()
  // IMDB-only titles whose own request went unanswered: neither found nor
  // "not found", so never stamped.
  const unansweredIds = new Set<string>()

  try {
    // Fetch TMDB items (most items should have TMDB IDs). A request MDBList
    // did not answer throws here, before anything is stamped.
    if (tmdbItems.length > 0) {
      const tmdbIds = tmdbItems.map((item) => item.tmdb_id!)
      const mediaInfoList = await getMediaInfoByTmdbBatchOrThrow(tmdbIds, mediaType)

      // Map results back by TMDB ID
      const tmdbIdToInfo = new Map<number, MDBListEnrichmentData>()
      for (const info of mediaInfoList) {
        if (info.tmdbid) {
          tmdbIdToInfo.set(info.tmdbid, extractEnrichmentData(info))
        }
      }

      // Link to item IDs
      for (const item of tmdbItems) {
        const data = tmdbIdToInfo.get(parseInt(item.tmdb_id!, 10))
        if (data) {
          infoByItemId.set(item.id, data)
        }
      }
    }
  } catch (err) {
    // A failed request is not an answer: nothing is stamped, so these titles
    // are retried next run. Stamping them here is what left most of a
    // library without scores or providers.
    logger.error({ err, table, items: items.length }, 'Batch MDBList fetch failed')
    return { ...result, requestFailed: true, unstampedIds: items.map((item) => item.id) }
  }

  // For items without TMDB, try IMDB (less common case). Null is "no entry";
  // anything else that went wrong throws and leaves the title unstamped.
  for (const item of imdbOnlyItems) {
    try {
      const info = await getMediaInfoByImdbOrThrow(item.imdb_id!)
      if (info) {
        infoByItemId.set(item.id, extractEnrichmentData(info))
      }
    } catch (err) {
      logger.warn({ err, table, imdbId: item.imdb_id }, 'MDBList IMDB lookup failed')
      unansweredIds.add(item.id)
    }
  }

  // Prepare bulk update data
  const updates: EnrichmentUpdate[] = []
  const notFoundIds: string[] = []

  for (const item of items) {
    if (unansweredIds.has(item.id)) continue
    const data = infoByItemId.get(item.id)
    if (data) {
      updates.push({
        id: item.id,
        letterboxdScore: data.letterboxdScore,
        mdblistScore: data.mdblistScore,
        rtCriticScore: data.rtCriticScore,
        rtAudienceScore: data.rtAudienceScore,
        metacriticScore: data.metacriticScore,
        streamingProviders: JSON.stringify(data.streamingProviders),
        keywords: data.keywords.length > 0 ? data.keywords : null,
      })
    } else {
      notFoundIds.push(item.id)
    }
  }
  result.unstampedIds.push(...unansweredIds)

  // Bulk update items with data (single query!). A failed write answers 0
  // and stamps nothing.
  if (updates.length > 0) {
    const updated = table === 'movies'
      ? await bulkUpdateMovies(updates)
      : await bulkUpdateSeries(updates)
    result.enriched = updated
    if (updated === 0) result.unstampedIds.push(...updates.map((u) => u.id))
    logger.debug({ table, updates: updates.length, updated }, 'Bulk update completed')
  }

  // Mark items MDBList answered without as processed (single query!):
  // "no entry" is an answer, and is asked again after the refresh window.
  if (notFoundIds.length > 0) {
    logger.debug({ table, notFoundIds: notFoundIds.length }, 'Marking items without MDBList data as processed')
    if (!(await markAsProcessed(notFoundIds, table))) result.unstampedIds.push(...notFoundIds)
  }
  result.notFound = notFoundIds.length

  return result
}

// ============================================================================
// Main Enrichment Job
// ============================================================================

/** One table's pass over MDBList, and where its counts go in the progress. */
interface TablePass {
  table: 'movies' | 'series'
  mediaType: 'movie' | 'show'
  step: number
  stepLabel: string
  logLabel: string
  total: number
  processed: 'moviesProcessed' | 'seriesProcessed'
  enriched: 'moviesEnriched' | 'seriesEnriched'
  failed: 'moviesFailed' | 'seriesFailed'
}

/**
 * Run MDBList metadata enrichment for movies and series
 */
export async function enrichMDBListMetadata(jobId: string): Promise<MDBListEnrichmentProgress> {
  const progress: MDBListEnrichmentProgress = {
    moviesProcessed: 0,
    moviesEnriched: 0,
    moviesFailed: 0,
    seriesProcessed: 0,
    seriesEnriched: 0,
    seriesFailed: 0,
  }

  // Check if MDBList is configured
  const config = await getMDBListConfig()
  if (!config.enabled || !config.hasApiKey) {
    logger.warn('MDBList not configured - skipping enrichment')
    return progress
  }

  createJobProgress(jobId, 'enrich-mdblist', 2) // 2 steps: movies, series

  try {
    // Get counts (the same rule the selections use)
    const totalMovies = await countItemsNeedingMDBListEnrichment('movies')
    const totalSeries = await countItemsNeedingMDBListEnrichment('series')
    const totalItems = totalMovies + totalSeries

    if (totalItems === 0) {
      addLog(jobId, 'info', 'No items need MDBList enrichment')
      completeJob(jobId, { progress })
      return progress
    }

    const startTime = Date.now()
    const tierLabel = config.supporterTier ? 'supporter' : 'free'
    logger.info(
      { totalMovies, totalSeries, tier: tierLabel },
      'Starting MDBList metadata enrichment'
    )

    addLog(jobId, 'info', `MDBList tier: ${tierLabel}`)
    addLog(jobId, 'info', `Found ${totalMovies} movies and ${totalSeries} series to enrich`)

    // Titles a batch left unstamped this run. Stamped titles stop being due
    // on their own; these are still due and would be selected again forever.
    const skipIds: string[] = []
    // Consecutive batches MDBList did not answer. An outage or a spent daily
    // quota fails every request after it, so the run stops rather than
    // spending the rest of the library on refusals.
    let failedBatchesInRow = 0
    let stoppedReason: string | null = null

    const passes: TablePass[] = [
      {
        table: 'movies',
        mediaType: 'movie',
        step: 0,
        stepLabel: 'Enriching movies from MDBList',
        logLabel: '📽 Movies',
        total: totalMovies,
        processed: 'moviesProcessed',
        enriched: 'moviesEnriched',
        failed: 'moviesFailed',
      },
      {
        table: 'series',
        mediaType: 'show',
        step: 1,
        stepLabel: 'Enriching series from MDBList',
        logLabel: '📺 Series',
        total: totalSeries,
        processed: 'seriesProcessed',
        enriched: 'seriesEnriched',
        failed: 'seriesFailed',
      },
    ]

    for (const pass of passes) {
      if (pass.total === 0 || stoppedReason || isJobCancelled(jobId)) continue
      setJobStep(jobId, pass.step, pass.stepLabel, totalItems)

      while (!stoppedReason && !isJobCancelled(jobId)) {
        const items = await getItemsNeedingMDBListEnrichment(pass.table, skipIds, DB_BATCH_SIZE)
        if (items.length === 0) break

        // Process in batches for the API
        for (let i = 0; i < items.length && !stoppedReason && !isJobCancelled(jobId); i += BATCH_SIZE) {
          const batch = items.slice(i, i + BATCH_SIZE)
          const batchResult = await processBatch(batch, pass.mediaType, pass.table)
          skipIds.push(...batchResult.unstampedIds)

          failedBatchesInRow = batchResult.requestFailed ? failedBatchesInRow + 1 : 0
          if (failedBatchesInRow >= MAX_FAILED_BATCHES_IN_ROW) {
            stoppedReason = `MDBList failed ${failedBatchesInRow} requests in a row; stopped. The titles not reached are retried next run.`
          }

          progress[pass.processed] += batch.length
          progress[pass.enriched] += batchResult.enriched
          progress[pass.failed] += batchResult.notFound + batchResult.unstampedIds.length

          updateJobProgress(jobId, progress.moviesProcessed + progress.seriesProcessed, totalItems)

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          addLog(
            jobId,
            'info',
            `${pass.logLabel}: ${progress[pass.processed]}/${pass.total} (${progress[pass.enriched]} enriched, ${elapsed}s elapsed)`
          )
        }
      }
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    const summary = `Enriched ${progress.moviesEnriched} movies and ${progress.seriesEnriched} series from MDBList in ${totalDuration}s`

    // A run MDBList stopped answering is a failed run, not a quiet success:
    // "completed" every week is how ten months of empty stamps went unseen.
    // What was written stays written; the rest is retried next run.
    if (stoppedReason) {
      addLog(jobId, 'warn', `${stoppedReason} ${summary} before stopping.`)
      logger.warn(progress, 'MDBList metadata enrichment stopped: MDBList is not answering')
      failJob(jobId, stoppedReason)
      return progress
    }

    addLog(jobId, 'info', `🎉 ${summary}`)
    completeJob(jobId, { progress })

    logger.info(progress, 'MDBList metadata enrichment complete')
    return progress
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err }, 'MDBList metadata enrichment failed')
    failJob(jobId, error)
    throw err
  }
}

/**
 * Get MDBList enrichment statistics
 */
export async function getMDBListEnrichmentStats(): Promise<{
  movies: { total: number; enriched: number; pending: number }
  series: { total: number; enriched: number; pending: number }
}> {
  // `enriched` is "MDBList has been asked at least once"; `pending` is what the
  // job will ask next (MDBLIST_PENDING_SQL), which includes titles whose
  // answer is older than the refresh window. So the two need not add up to
  // the total, and enriched never falls as answers age.
  const stats = async (table: 'movies' | 'series') => {
    const row = await queryOne<{ total: string; enriched: string; pending: string }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE mdblist_enriched_at IS NOT NULL) as enriched,
         COUNT(*) FILTER (WHERE ${MDBLIST_PENDING_SQL}) as pending
       FROM ${table}
       WHERE tmdb_id IS NOT NULL OR imdb_id IS NOT NULL`
    )
    return {
      total: parseInt(row?.total || '0', 10),
      enriched: parseInt(row?.enriched || '0', 10),
      pending: parseInt(row?.pending || '0', 10),
    }
  }

  const [movies, series] = await Promise.all([stats('movies'), stats('series')])
  return { movies, series }
}

/**
 * Clear MDBList enrichment data (for re-enriching)
 */
export async function clearMDBListEnrichmentData(): Promise<void> {
  await query(`UPDATE movies SET mdblist_enriched_at = NULL`)
  await query(`UPDATE series SET mdblist_enriched_at = NULL`)
  logger.info('MDBList enrichment data cleared')
}

/**
 * Enrich a single item immediately (for on-demand enrichment)
 */
export async function enrichSingleItem(
  imdbId: string,
  type: 'movie' | 'series'
): Promise<MDBListEnrichmentData | null> {
  const config = await getMDBListConfig()
  if (!config.enabled || !config.hasApiKey) {
    return null
  }

  try {
    const info = await getMediaInfoByImdb(imdbId)
    if (!info) return null

    const data = extractEnrichmentData(info)

    if (type === 'movie') {
      await query(
        `UPDATE movies SET
           letterboxd_score = COALESCE($2, letterboxd_score),
           mdblist_score = COALESCE($3, mdblist_score),
           rt_critic_score = COALESCE($4, rt_critic_score),
           rt_audience_score = COALESCE($5, rt_audience_score),
           metacritic_score = COALESCE($6, metacritic_score),
           streaming_providers = COALESCE($7, streaming_providers),
           mdblist_keywords = COALESCE($8, mdblist_keywords),
           mdblist_enriched_at = NOW()
         WHERE imdb_id = $1`,
        [
          imdbId,
          data.letterboxdScore,
          data.mdblistScore,
          data.rtCriticScore,
          data.rtAudienceScore,
          data.metacriticScore,
          JSON.stringify(data.streamingProviders),
          data.keywords.length > 0 ? data.keywords : null,
        ]
      )
    } else {
      await query(
        `UPDATE series SET
           letterboxd_score = COALESCE($2, letterboxd_score),
           mdblist_score = COALESCE($3, mdblist_score),
           rt_critic_score = COALESCE($4, rt_critic_score),
           rt_audience_score = COALESCE($5, rt_audience_score),
           metacritic_score = COALESCE($6, metacritic_score),
           streaming_providers = COALESCE($7, streaming_providers),
           mdblist_keywords = COALESCE($8, mdblist_keywords),
           mdblist_enriched_at = NOW()
         WHERE imdb_id = $1`,
        [
          imdbId,
          data.letterboxdScore,
          data.mdblistScore,
          data.rtCriticScore,
          data.rtAudienceScore,
          data.metacriticScore,
          JSON.stringify(data.streamingProviders),
          data.keywords.length > 0 ? data.keywords : null,
        ]
      )
    }

    return data
  } catch (err) {
    logger.error({ err, imdbId, type }, 'Failed to enrich single item')
    return null
  }
}

