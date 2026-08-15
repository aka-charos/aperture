/**
 * Metadata Enrichment Module
 *
 * Enriches movies and series with data from TMDb and OMDb:
 * - TMDb: Keywords, collections/franchises, expanded crew
 * - OMDb: Rotten Tomatoes scores, Metacritic, awards, languages, countries
 *
 * PERFORMANCE OPTIMIZED:
 * - TMDb and OMDb calls made in parallel per item
 * - Multiple items processed concurrently (within API rate limits)
 * - TMDb: ~40 req/sec (limit is ~50)
 * - OMDb: ~10 req/sec (conservative for free tier)
 *
 * DB WRITE STRATEGY:
 * - Individual UPDATEs per item (not batched) - intentional design choice
 * - API calls are the bottleneck (~1-2 sec per item), not DB writes (~1ms)
 * - Per-item writes ensure progress is saved immediately (crash resilience)
 * - Batch DB writes would only save ~100ms per 100 items but add complexity
 *
 * RUN TRACKING:
 * - Enrichment runs are tracked in the enrichment_runs table
 * - If a run is interrupted (container restart, crash), it's detected on next startup
 * - Progress is persisted so incomplete runs can be resumed
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
import { getTMDbConfig, getOMDbConfig } from '../settings/systemSettings.js'
import {
  getMovieEnrichmentData,
  getCollectionData,
  type CollectionData,
  type ApiLogCallback,
} from '../tmdb/index.js'
import { getSeriesEnrichmentData } from '../tmdb/series.js'
import { getRatingsData } from '../omdb/ratings.js'
import { OmdbRequestError, isGlobalOmdbFailure } from '../omdb/failures.js'
import type { RatingsData } from '../omdb/types.js'
import { needsEnrichmentSql } from './pending.js'

const logger = createChildLogger('enrichment')

// ============================================================================
// What still needs enriching
// ============================================================================

/** OMDb can only be asked when it is switched on AND holds a key. */
async function isOmdbUsable(): Promise<boolean> {
  const config = await getOMDbConfig()
  return config.enabled && config.hasApiKey
}

// ============================================================================
// Enrichment Run Tracking
// ============================================================================

interface EnrichmentRun {
  id: string
  target_version: number
  expected_movies: number
  expected_series: number
  processed_movies: number
  processed_series: number
  enriched_movies: number
  enriched_series: number
  failed_movies: number
  failed_series: number
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  job_id: string | null
  started_at: Date
  completed_at: Date | null
  last_updated_at: Date
}

/**
 * Check for and mark any incomplete enrichment runs as interrupted
 * Call this on application startup
 */
export async function detectInterruptedEnrichmentRuns(): Promise<void> {
  try {
    const result = await query<EnrichmentRun>(
      `UPDATE enrichment_runs 
       SET status = 'interrupted', last_updated_at = NOW()
       WHERE status = 'running'
       RETURNING *`
    )
    
    if (result.rows.length > 0) {
      for (const run of result.rows) {
        const totalExpected = run.expected_movies + run.expected_series
        const totalProcessed = run.processed_movies + run.processed_series
        logger.warn(
          { 
            runId: run.id, 
            expectedMovies: run.expected_movies,
            expectedSeries: run.expected_series,
            processedMovies: run.processed_movies,
            processedSeries: run.processed_series,
            targetVersion: run.target_version,
          },
          `Detected interrupted enrichment run: ${totalProcessed}/${totalExpected} items processed`
        )
      }
    }
  } catch (err) {
    // Table might not exist yet (pre-migration) - that's OK
    logger.debug({ err }, 'Could not check for interrupted enrichment runs (table may not exist)')
  }
}

/**
 * Get the status of the last enrichment run (if any)
 */
export async function getLastEnrichmentRun(): Promise<EnrichmentRun | null> {
  try {
    const result = await queryOne<EnrichmentRun>(
      `SELECT * FROM enrichment_runs ORDER BY started_at DESC LIMIT 1`
    )
    return result || null
  } catch (err) {
    // Table might not exist yet (pre-migration)
    logger.debug({ err }, 'Could not get last enrichment run (table may not exist)')
    return null
  }
}

/**
 * Get incomplete enrichment run status
 * Returns info about any interrupted run that needs attention
 */
export async function getIncompleteEnrichmentRun(): Promise<{
  hasIncompleteRun: boolean
  run: EnrichmentRun | null
  remainingMovies: number
  remainingSeries: number
} | null> {
  const lastRun = await getLastEnrichmentRun()
  
  if (!lastRun || lastRun.status === 'completed') {
    return { hasIncompleteRun: false, run: null, remainingMovies: 0, remainingSeries: 0 }
  }
  
  // For interrupted runs, calculate what's left
  if (lastRun.status === 'interrupted') {
    // Get current pending counts (items still needing enrichment at target version)
    const versionResult = await queryOne<{ value: string }>(
      `SELECT value FROM system_settings WHERE key = 'enrichment_version'`
    )
    const currentVersion = parseInt(versionResult?.value || '1', 10)
    const omdbEnabled = await isOmdbUsable()

    const movieCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM movies
       WHERE ${needsEnrichmentSql('movies', '$1', omdbEnabled)}`,
      [currentVersion]
    )
    const seriesCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM series
       WHERE ${needsEnrichmentSql('series', '$1', omdbEnabled)}`,
      [currentVersion]
    )

    return {
      hasIncompleteRun: true,
      run: lastRun,
      remainingMovies: parseInt(movieCount?.count || '0', 10),
      remainingSeries: parseInt(seriesCount?.count || '0', 10),
    }
  }
  
  return { hasIncompleteRun: false, run: lastRun, remainingMovies: 0, remainingSeries: 0 }
}

/**
 * Create a new enrichment run record
 * Returns null if the table doesn't exist (pre-migration)
 */
async function createEnrichmentRun(
  jobId: string,
  targetVersion: number,
  expectedMovies: number,
  expectedSeries: number
): Promise<string | null> {
  try {
    const result = await queryOne<{ id: string }>(
      `INSERT INTO enrichment_runs (job_id, target_version, expected_movies, expected_series, status)
       VALUES ($1, $2, $3, $4, 'running')
       RETURNING id`,
      [jobId, targetVersion, expectedMovies, expectedSeries]
    )
    return result!.id
  } catch (err) {
    // Table might not exist yet (pre-migration) - enrichment will still work
    logger.debug({ err }, 'Could not create enrichment run record (table may not exist)')
    return null
  }
}

/**
 * Update enrichment run progress
 */
async function updateEnrichmentRunProgress(
  runId: string | null,
  processedMovies: number,
  processedSeries: number,
  enrichedMovies: number,
  enrichedSeries: number,
  failedMovies: number,
  failedSeries: number
): Promise<void> {
  if (!runId) return // No run tracking if table doesn't exist
  
  try {
    await query(
      `UPDATE enrichment_runs 
       SET processed_movies = $2, processed_series = $3,
           enriched_movies = $4, enriched_series = $5,
           failed_movies = $6, failed_series = $7,
           last_updated_at = NOW()
       WHERE id = $1`,
      [runId, processedMovies, processedSeries, enrichedMovies, enrichedSeries, failedMovies, failedSeries]
    )
  } catch (err) {
    // Silently fail - run tracking is optional
    logger.debug({ err, runId }, 'Could not update enrichment run progress')
  }
}

/**
 * Complete an enrichment run
 */
async function completeEnrichmentRun(
  runId: string | null,
  status: 'completed' | 'failed' | 'cancelled'
): Promise<void> {
  if (!runId) return // No run tracking if table doesn't exist
  
  try {
    await query(
      `UPDATE enrichment_runs 
       SET status = $2, completed_at = NOW(), last_updated_at = NOW()
       WHERE id = $1`,
      [runId, status]
    )
  } catch (err) {
    // Silently fail - run tracking is optional
    logger.debug({ err, runId, status }, 'Could not complete enrichment run')
  }
}

/**
 * Reset/clear interrupted enrichment run
 * Allows user to acknowledge and clear the interrupted state
 */
export async function clearInterruptedEnrichmentRun(): Promise<boolean> {
  try {
    const result = await query(
      `UPDATE enrichment_runs 
       SET status = 'cancelled', completed_at = NOW(), last_updated_at = NOW()
       WHERE status = 'interrupted'`
    )
    return (result.rowCount ?? 0) > 0
  } catch (err) {
    // Table might not exist yet (pre-migration)
    logger.debug({ err }, 'Could not clear interrupted enrichment run (table may not exist)')
    return false
  }
}

// ============================================================================
// PERFORMANCE TUNING CONSTANTS
// ============================================================================
// These control how aggressively we call external APIs.
// Increase CONCURRENCY for faster processing, decrease if hitting rate limits.

/** Number of items to process concurrently */
const CONCURRENCY = 5

/** Number of items to fetch per database query */
const BATCH_SIZE = 100

/**
 * Create a logging callback for API calls during enrichment
 */
function createApiLogger(jobId: string, _itemTitle: string): ApiLogCallback {
  return (service, endpoint, status, details) => {
    const serviceLabel = service.toUpperCase()
    const statusIcon = status === 'success' ? '✓' : status === 'not_found' ? '○' : '✗'
    const detailsSuffix = details ? ` (${details})` : ''
    
    // Only log API calls for verbose debugging - we log per-item summaries instead
    // But we do log errors and not_found for visibility
    if (status === 'error') {
      addLog(jobId, 'warn', `${serviceLabel} ${statusIcon} ${endpoint}${detailsSuffix}`)
    }
  }
}

// ============================================================================
// Types
// ============================================================================

interface EnrichmentProgress {
  moviesProcessed: number
  moviesEnriched: number
  moviesFailed: number
  seriesProcessed: number
  seriesEnriched: number
  seriesFailed: number
  collectionsCreated: number
}

interface MovieToEnrich {
  id: string
  title: string
  tmdb_id: string | null
  imdb_id: string | null
}

interface SeriesToEnrich {
  id: string
  title: string
  tmdb_id: string | null
  imdb_id: string | null
  tvdb_id: string | null
}

// ============================================================================
// Movie Enrichment
// ============================================================================

/**
 * Get movies that need enrichment
 * Includes: never enriched OR enrichment version is outdated
 */
async function getMoviesNeedingEnrichment(
  omdbEnabled: boolean,
  limit: number = 100
): Promise<MovieToEnrich[]> {
  // Get current enrichment version from system settings
  const versionResult = await queryOne<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'enrichment_version'`
  )
  const currentVersion = parseInt(versionResult?.value || '1', 10)

  const result = await query<MovieToEnrich>(
    `SELECT id, title, tmdb_id, imdb_id
     FROM movies
     WHERE ${needsEnrichmentSql('movies', '$2', omdbEnabled)}
     ORDER BY
       CASE WHEN enriched_at IS NULL THEN 0 ELSE 1 END,  -- New items first
       created_at DESC
     LIMIT $1`,
    [limit, currentVersion]
  )
  return result.rows
}

/**
 * Whether OMDb was actually asked, kept separate from whether it had anything
 * to say. `data: null` alone cannot distinguish "we never called" from "we
 * called and it has no entry", and stamping omdb_enriched_at needs exactly
 * that distinction: the second must be recorded or those titles are re-fetched
 * on every pass forever, the first must not be or the gap re-freezes.
 *
 * An error counts as NOT attempted, so a transient outage retries next run.
 * That guarantee rests on the client *throwing* rather than returning null for
 * a failed request: when it returned null for an HTTP 401 exactly as it does
 * for a genuine "Movie not found!", every row an auth outage touched was
 * stamped OMDb-complete and retired for good.
 */
interface OmdbOutcome {
  attempted: boolean
  data: RatingsData | null
}

const OMDB_NOT_ASKED: OmdbOutcome = { attempted: false, data: null }

/**
 * Jobs that have already announced a global OMDb failure.
 *
 * A bad key or a spent quota is true of every remaining title, so reporting it
 * per title says the same thing twelve thousand times and buries the one line
 * the operator needs. The client stops making requests on its own; this only
 * decides where the explanation goes.
 */
const omdbFailureAnnounced = new Set<string>()

/**
 * Turn an OMDb failure into the per-item log string, announcing it once per run
 * if it is the kind that will not fix itself.
 */
function describeOmdbFailure(err: unknown, jobId: string): string {
  if (!(err instanceof OmdbRequestError)) return 'OMDb: error'

  if (isGlobalOmdbFailure(err.kind) && !omdbFailureAnnounced.has(jobId)) {
    omdbFailureAnnounced.add(jobId)
    const cause =
      err.kind === 'auth' ? 'rejected the API key' : 'reports its daily request limit reached'
    addLog(
      jobId,
      'error',
      `⛔ OMDb ${cause}: ${err.omdbError ?? `HTTP ${err.status}`}. Skipping OMDb for the rest of this run. ` +
        `Nothing is marked OMDb-enriched, so these titles are picked up again once it's resolved. TMDb enrichment continues.`
    )
  }

  return `OMDb: ${err.omdbError ?? 'error'}`
}

/**
 * Enrich a single movie with TMDb and OMDb data
 * OPTIMIZED: TMDb and OMDb calls are made in parallel
 */
async function enrichMovie(
  movie: MovieToEnrich,
  tmdbEnabled: boolean,
  omdbEnabled: boolean,
  collectionsToCreate: Map<number, CollectionData>,
  jobId: string
): Promise<boolean> {
  const onLog = createApiLogger(jobId, movie.title)
  const apiResults: string[] = []

  // Prepare parallel API calls
  const tmdbPromise =
    tmdbEnabled && (movie.tmdb_id || movie.imdb_id)
      ? (async () => {
          try {
            const tmdbId = movie.tmdb_id ? parseInt(movie.tmdb_id, 10) : null
            const data = await getMovieEnrichmentData(tmdbId, movie.imdb_id, { onLog })
            if (data) {
              const info: string[] = []
              if (data.keywords?.length) info.push(`${data.keywords.length} keywords`)
              if (data.collectionName) info.push(`collection: ${data.collectionName}`)
              apiResults.push(`TMDb: ${info.length > 0 ? info.join(', ') : 'no data'}`)
            } else {
              apiResults.push('TMDb: not found')
            }
            return data
          } catch (err) {
            logger.warn({ err, movieId: movie.id, title: movie.title }, 'Failed to fetch TMDb data')
            apiResults.push('TMDb: error')
            return null
          }
        })()
      : Promise.resolve(null)

  const omdbPromise: Promise<OmdbOutcome> =
    omdbEnabled && movie.imdb_id
      ? (async () => {
          try {
            const data = await getRatingsData(movie.imdb_id!, { onLog })
            if (data) {
              const info: string[] = []
              if (data.rtCriticScore != null) info.push(`RT: ${data.rtCriticScore}%`)
              if (data.metacriticScore != null) info.push(`MC: ${data.metacriticScore}`)
              if (data.languages?.length) info.push(`${data.languages.length} lang`)
              if (data.countries?.length) info.push(`${data.countries.length} country`)
              apiResults.push(`OMDb: ${info.length > 0 ? info.join(', ') : 'no data'}`)
            } else {
              apiResults.push('OMDb: not found')
            }
            // Asked and answered, even when the answer was "no entry".
            return { attempted: true, data }
          } catch (err) {
            logger.warn({ err, movieId: movie.id, title: movie.title }, 'Failed to fetch OMDb data')
            apiResults.push(describeOmdbFailure(err, jobId))
            return OMDB_NOT_ASKED
          }
        })()
      : Promise.resolve(OMDB_NOT_ASKED)

  // Execute both API calls in parallel
  const [tmdbData, omdb] = await Promise.all([tmdbPromise, omdbPromise])
  const omdbData = omdb.data

  // Log API results summary for this movie
  if (apiResults.length > 0) {
    addLog(jobId, 'debug', `📽 ${movie.title}: ${apiResults.join(' | ')}`)
  }

  // If we got collection data, queue it for creation
  if (tmdbData?.collectionId && tmdbData?.collectionName) {
    if (!collectionsToCreate.has(tmdbData.collectionId)) {
      const collectionData = await getCollectionData(tmdbData.collectionId, { onLog })
      if (collectionData) {
        collectionsToCreate.set(tmdbData.collectionId, collectionData)
      }
    }
  }

  // Update movie in database
  try {
    await query(
      `UPDATE movies SET
         keywords = COALESCE($2, keywords),
         collection_id = COALESCE($3, collection_id),
         collection_name = COALESCE($4, collection_name),
         cinematographers = COALESCE($5, cinematographers),
         composers = COALESCE($6, composers),
         editors = COALESCE($7, editors),
         rt_critic_score = COALESCE($8, rt_critic_score),
         rt_audience_score = COALESCE($9, rt_audience_score),
         metacritic_score = COALESCE($10, metacritic_score),
         awards_summary = COALESCE($11, awards_summary),
         languages = COALESCE($12, languages),
         production_countries = COALESCE($13, production_countries),
         plot_full = COALESCE($15, plot_full),
         tmdb_rating = COALESCE($16, tmdb_rating),
         tmdb_vote_count = COALESCE($17, tmdb_vote_count),
         imdb_rating = COALESCE($18, imdb_rating),
         imdb_vote_count = COALESCE($19, imdb_vote_count),
         enriched_at = NOW(),
         enrichment_version = COALESCE((SELECT value::int FROM system_settings WHERE key = 'enrichment_version'), 1),
         -- Only advance when OMDb was actually asked; CASE rather than COALESCE
         -- so a pass that skipped OMDb leaves an earlier timestamp intact.
         omdb_enriched_at = CASE WHEN $14 THEN NOW() ELSE omdb_enriched_at END
       WHERE id = $1`,
      [
        movie.id,
        tmdbData?.keywords ?? null,
        tmdbData?.collectionId?.toString() ?? null,
        tmdbData?.collectionName ?? null,
        tmdbData?.cinematographers ?? null,
        tmdbData?.composers ?? null,
        tmdbData?.editors ?? null,
        omdbData?.rtCriticScore ?? null,
        omdbData?.rtAudienceScore ?? null,
        omdbData?.metacriticScore ?? null,
        omdbData?.awardsSummary ?? null,
        omdbData?.languages ?? null,
        omdbData?.countries ?? null,
        omdb.attempted,
        omdbData?.plot ?? null,
        tmdbData?.voteAverage ?? null,
        tmdbData?.voteCount ?? null,
        omdbData?.imdbRating ?? null,
        omdbData?.imdbVotes ?? null,
      ]
    )
    return true
  } catch (err) {
    logger.error({ err, movieId: movie.id }, 'Failed to update movie with enrichment data')
    return false
  }
}

// ============================================================================
// Series Enrichment
// ============================================================================

/**
 * Get series that need enrichment
 */
async function getSeriesNeedingEnrichment(
  omdbEnabled: boolean,
  limit: number = 100
): Promise<SeriesToEnrich[]> {
  // Get current enrichment version from system settings
  const versionResult = await queryOne<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'enrichment_version'`
  )
  const currentVersion = parseInt(versionResult?.value || '1', 10)

  const result = await query<SeriesToEnrich>(
    `SELECT id, title, tmdb_id, imdb_id, tvdb_id
     FROM series
     WHERE ${needsEnrichmentSql('series', '$2', omdbEnabled)}
     ORDER BY
       CASE WHEN enriched_at IS NULL THEN 0 ELSE 1 END,  -- New items first
       created_at DESC
     LIMIT $1`,
    [limit, currentVersion]
  )
  return result.rows
}

/**
 * Enrich a single series with TMDb and OMDb data
 * OPTIMIZED: TMDb and OMDb calls are made in parallel
 */
async function enrichSeries(
  series: SeriesToEnrich,
  tmdbEnabled: boolean,
  omdbEnabled: boolean,
  jobId: string
): Promise<boolean> {
  const onLog = createApiLogger(jobId, series.title)
  const apiResults: string[] = []

  // Prepare parallel API calls
  const tmdbPromise =
    tmdbEnabled && (series.tmdb_id || series.imdb_id || series.tvdb_id)
      ? (async () => {
          try {
            const tmdbId = series.tmdb_id ? parseInt(series.tmdb_id, 10) : null
            const data = await getSeriesEnrichmentData(tmdbId, series.imdb_id, series.tvdb_id, {
              onLog,
            })
            if (data) {
              const info: string[] = []
              if (data.keywords?.length) info.push(`${data.keywords.length} keywords`)
              apiResults.push(`TMDb: ${info.length > 0 ? info.join(', ') : 'no data'}`)
            } else {
              apiResults.push('TMDb: not found')
            }
            return data
          } catch (err) {
            logger.warn(
              { err, seriesId: series.id, title: series.title },
              'Failed to fetch TMDb data'
            )
            apiResults.push('TMDb: error')
            return null
          }
        })()
      : Promise.resolve(null)

  const omdbPromise: Promise<OmdbOutcome> =
    omdbEnabled && series.imdb_id
      ? (async () => {
          try {
            const data = await getRatingsData(series.imdb_id!, { onLog })
            if (data) {
              const info: string[] = []
              if (data.rtCriticScore != null) info.push(`RT: ${data.rtCriticScore}%`)
              if (data.metacriticScore != null) info.push(`MC: ${data.metacriticScore}`)
              if (data.languages?.length) info.push(`${data.languages.length} lang`)
              if (data.countries?.length) info.push(`${data.countries.length} country`)
              apiResults.push(`OMDb: ${info.length > 0 ? info.join(', ') : 'no data'}`)
            } else {
              apiResults.push('OMDb: not found')
            }
            // Asked and answered, even when the answer was "no entry".
            return { attempted: true, data }
          } catch (err) {
            logger.warn(
              { err, seriesId: series.id, title: series.title },
              'Failed to fetch OMDb data'
            )
            apiResults.push(describeOmdbFailure(err, jobId))
            return OMDB_NOT_ASKED
          }
        })()
      : Promise.resolve(OMDB_NOT_ASKED)

  // Execute both API calls in parallel
  const [tmdbData, omdb] = await Promise.all([tmdbPromise, omdbPromise])
  const omdbData = omdb.data

  // Log API results summary for this series
  if (apiResults.length > 0) {
    addLog(jobId, 'debug', `📺 ${series.title}: ${apiResults.join(' | ')}`)
  }

  // Update series in database
  try {
    await query(
      `UPDATE series SET
         keywords = COALESCE($2, keywords),
         rt_critic_score = COALESCE($3, rt_critic_score),
         rt_audience_score = COALESCE($4, rt_audience_score),
         metacritic_score = COALESCE($5, metacritic_score),
         awards_summary = COALESCE($6, awards_summary),
         languages = COALESCE($7, languages),
         production_countries = COALESCE($8, production_countries),
         plot_full = COALESCE($10, plot_full),
         tmdb_rating = COALESCE($11, tmdb_rating),
         tmdb_vote_count = COALESCE($12, tmdb_vote_count),
         imdb_rating = COALESCE($13, imdb_rating),
         imdb_vote_count = COALESCE($14, imdb_vote_count),
         enriched_at = NOW(),
         enrichment_version = COALESCE((SELECT value::int FROM system_settings WHERE key = 'enrichment_version'), 1),
         -- Only advance when OMDb was actually asked; CASE rather than COALESCE
         -- so a pass that skipped OMDb leaves an earlier timestamp intact.
         omdb_enriched_at = CASE WHEN $9 THEN NOW() ELSE omdb_enriched_at END
       WHERE id = $1`,
      [
        series.id,
        tmdbData?.keywords ?? null,
        omdbData?.rtCriticScore ?? null,
        omdbData?.rtAudienceScore ?? null,
        omdbData?.metacriticScore ?? null,
        omdbData?.awardsSummary ?? null,
        omdbData?.languages ?? null,
        omdbData?.countries ?? null,
        omdb.attempted,
        omdbData?.plot ?? null,
        tmdbData?.voteAverage ?? null,
        tmdbData?.voteCount ?? null,
        omdbData?.imdbRating ?? null,
        omdbData?.imdbVotes ?? null,
      ]
    )
    return true
  } catch (err) {
    logger.error({ err, seriesId: series.id }, 'Failed to update series with enrichment data')
    return false
  }
}

// ============================================================================
// Collection Management
// ============================================================================

/**
 * Create or update a collection in the database
 */
async function upsertCollection(data: CollectionData): Promise<void> {
  await query(
    `INSERT INTO collections (tmdb_id, name, overview, poster_url, backdrop_url, enriched_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (tmdb_id) DO UPDATE SET
       name = EXCLUDED.name,
       overview = EXCLUDED.overview,
       poster_url = EXCLUDED.poster_url,
       backdrop_url = EXCLUDED.backdrop_url,
       enriched_at = NOW()`,
    [
      data.tmdbId.toString(),
      data.name,
      data.overview,
      data.posterUrl,
      data.backdropUrl,
    ]
  )
}

/**
 * Update movie count for all collections
 */
async function updateCollectionCounts(): Promise<void> {
  await query(
    `UPDATE collections c SET
       movie_count = (
         SELECT COUNT(*) FROM movies m
         WHERE m.collection_id = c.tmdb_id
       )`
  )
}

// ============================================================================
// Concurrent Processing Helper
// ============================================================================

/**
 * Process items with limited concurrency
 * Respects API rate limits by processing only N items at a time
 */
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<R>,
  shouldCancel?: () => boolean
): Promise<R[]> {
  const results: R[] = []
  let index = 0

  async function processNext(): Promise<void> {
    while (index < items.length) {
      if (shouldCancel?.()) break
      const currentIndex = index++
      const result = await processor(items[currentIndex])
      results[currentIndex] = result
    }
  }

  // Start N concurrent workers
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => processNext())

  await Promise.all(workers)
  return results
}

// ============================================================================
// Main Enrichment Job
// ============================================================================

/**
 * Run the full enrichment process for movies and series
 *
 * OPTIMIZED:
 * - TMDb and OMDb calls made in parallel per item
 * - Multiple items processed concurrently (CONCURRENCY setting)
 * - Larger batch sizes for fewer DB queries
 *
 * CRASH RESILIENT:
 * - Run state tracked in enrichment_runs table
 * - Detects and resumes from interrupted runs
 * - Progress persisted to survive container restarts
 */
export async function enrichMetadata(jobId: string): Promise<EnrichmentProgress> {
  const progress: EnrichmentProgress = {
    moviesProcessed: 0,
    moviesEnriched: 0,
    moviesFailed: 0,
    seriesProcessed: 0,
    seriesEnriched: 0,
    seriesFailed: 0,
    collectionsCreated: 0,
  }

  // Check if TMDb and OMDb are configured
  const tmdbConfig = await getTMDbConfig()
  const omdbConfig = await getOMDbConfig()
  const tmdbEnabled = tmdbConfig.enabled && tmdbConfig.hasApiKey
  const omdbEnabled = omdbConfig.enabled && omdbConfig.hasApiKey

  if (!tmdbEnabled && !omdbEnabled) {
    logger.warn('Neither TMDb nor OMDb is configured - skipping enrichment')
    return progress
  }

  // A resumed job reuses its id, and the announcement is once per *run*.
  omdbFailureAnnounced.delete(jobId)

  createJobProgress(jobId, 'enrich-metadata', 3) // 3 steps: movies, series, collections

  // Check for interrupted runs first
  const incompleteStatus = await getIncompleteEnrichmentRun()
  if (incompleteStatus?.hasIncompleteRun && incompleteStatus.run) {
    const remaining = incompleteStatus.remainingMovies + incompleteStatus.remainingSeries
    if (remaining > 0) {
      addLog(
        jobId, 
        'warn', 
        `⚠️ Resuming from interrupted run: ${incompleteStatus.run.processed_movies + incompleteStatus.run.processed_series} items were processed before interruption, ${remaining} remaining`
      )
      // Mark the old interrupted run as cancelled since we're starting fresh
      await clearInterruptedEnrichmentRun()
    }
  }

  let runId: string | null = null

  try {
    // Get current enrichment version
    const versionResult = await queryOne<{ value: string }>(
      `SELECT value FROM system_settings WHERE key = 'enrichment_version'`
    )
    const currentVersion = parseInt(versionResult?.value || '1', 10)

    // Counts for progress tracking. Must use the same predicate the selection
    // does, or the progress bar counts a different population than the loop
    // processes and the run appears to stall or finish early.
    const movieCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM movies
       WHERE ${needsEnrichmentSql('movies', '$1', omdbEnabled)}`,
      [currentVersion]
    )
    const seriesCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM series
       WHERE ${needsEnrichmentSql('series', '$1', omdbEnabled)}`,
      [currentVersion]
    )

    const totalMovies = parseInt(movieCount?.count || '0', 10)
    const totalSeries = parseInt(seriesCount?.count || '0', 10)
    const totalItems = totalMovies + totalSeries

    if (totalItems === 0) {
      addLog(jobId, 'info', `All items at enrichment version ${currentVersion} - nothing to do`)
      completeJob(jobId, { progress })
      return progress
    }

    // Create run tracking record
    runId = await createEnrichmentRun(jobId, currentVersion, totalMovies, totalSeries)
    logger.info({ runId, totalMovies, totalSeries, currentVersion }, 'Created enrichment run record')

    addLog(jobId, 'info', `Enrichment version: ${currentVersion}`)

    const startTime = Date.now()
    logger.info(
      { totalMovies, totalSeries, tmdbEnabled, omdbEnabled, concurrency: CONCURRENCY },
      'Starting metadata enrichment'
    )

    // Log which metadata services are enabled
    const enabledServices: string[] = []
    if (tmdbEnabled) enabledServices.push('TMDb')
    if (omdbEnabled) enabledServices.push('OMDb')
    addLog(jobId, 'info', `Metadata services enabled: ${enabledServices.join(', ')}`)
    addLog(jobId, 'info', `Found ${totalMovies} movies and ${totalSeries} series to enrich`)
    addLog(jobId, 'info', `⚡ Performance: ${CONCURRENCY} concurrent items, parallel API calls`)

    const collectionsToCreate = new Map<number, CollectionData>()

    // Every row this run has already handed to the enricher. See the movie loop
    // for why: without it, a row that legitimately stays pending after being
    // processed — which is exactly what an OMDb failure now produces — makes the
    // batch loop re-select it forever.
    const attemptedMovieIds = new Set<string>()
    const attemptedSeriesIds = new Set<string>()

    // Process movies with concurrency
    if (totalMovies > 0) {
      setJobStep(jobId, 0, 'Enriching movies', totalItems)

      while (true) {
        if (isJobCancelled(jobId)) {
          addLog(jobId, 'warn', 'Job cancelled by user')
          break
        }

        const fetched = await getMoviesNeedingEnrichment(omdbEnabled, BATCH_SIZE)
        // The loop ends when the pending selection stops returning work, so a
        // row that stays pending after being processed spins it forever. That
        // is now reachable: an OMDb failure deliberately leaves omdb_enriched_at
        // NULL, and the OMDb clause keeps re-selecting the row. Attempting each
        // row at most once per run is what makes the loop terminate, and it is
        // the correct rule anyway — a second attempt in the same pass would hit
        // the same failure. They stay pending for the *next* run, which is the
        // whole point of not stamping them.
        const movies = fetched.filter((m) => !attemptedMovieIds.has(m.id))
        if (movies.length === 0) break
        for (const movie of movies) attemptedMovieIds.add(movie.id)

        // Process batch concurrently
        const results = await processWithConcurrency(
          movies,
          CONCURRENCY,
          async (movie) => {
            const success = await enrichMovie(
              movie,
              tmdbEnabled,
              omdbEnabled,
              collectionsToCreate,
              jobId
            )
            return success
          },
          () => isJobCancelled(jobId)
        )

        // Update progress
        for (const success of results) {
          progress.moviesProcessed++
          if (success) {
            progress.moviesEnriched++
          } else {
            progress.moviesFailed++
          }
        }

        updateJobProgress(jobId, progress.moviesProcessed, totalItems)
        
        // Persist progress to database for crash recovery
        await updateEnrichmentRunProgress(
          runId,
          progress.moviesProcessed,
          progress.seriesProcessed,
          progress.moviesEnriched,
          progress.seriesEnriched,
          progress.moviesFailed,
          progress.seriesFailed
        )

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        const rate = (progress.moviesProcessed / parseFloat(elapsed)).toFixed(1)
        addLog(
          jobId,
          'info',
          `📽 Movies: ${progress.moviesProcessed}/${totalMovies} (${rate}/sec, ${progress.moviesEnriched} enriched)`
        )
      }
    }

    // Process series with concurrency
    if (totalSeries > 0 && !isJobCancelled(jobId)) {
      setJobStep(jobId, 1, 'Enriching series', totalItems)

      while (true) {
        if (isJobCancelled(jobId)) {
          addLog(jobId, 'warn', 'Job cancelled by user')
          break
        }

        // Same one-attempt-per-run rule as the movie loop above.
        const fetchedSeries = await getSeriesNeedingEnrichment(omdbEnabled, BATCH_SIZE)
        const seriesList = fetchedSeries.filter((s) => !attemptedSeriesIds.has(s.id))
        if (seriesList.length === 0) break
        for (const series of seriesList) attemptedSeriesIds.add(series.id)

        // Process batch concurrently
        const results = await processWithConcurrency(
          seriesList,
          CONCURRENCY,
          async (series) => {
            const success = await enrichSeries(series, tmdbEnabled, omdbEnabled, jobId)
            return success
          },
          () => isJobCancelled(jobId)
        )

        // Update progress
        for (const success of results) {
          progress.seriesProcessed++
          if (success) {
            progress.seriesEnriched++
          } else {
            progress.seriesFailed++
          }
        }

        updateJobProgress(jobId, progress.moviesProcessed + progress.seriesProcessed, totalItems)
        
        // Persist progress to database for crash recovery
        await updateEnrichmentRunProgress(
          runId,
          progress.moviesProcessed,
          progress.seriesProcessed,
          progress.moviesEnriched,
          progress.seriesEnriched,
          progress.moviesFailed,
          progress.seriesFailed
        )

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        const totalProcessed = progress.moviesProcessed + progress.seriesProcessed
        const rate = (totalProcessed / parseFloat(elapsed)).toFixed(1)
        addLog(
          jobId,
          'info',
          `📺 Series: ${progress.seriesProcessed}/${totalSeries} (${rate}/sec overall, ${progress.seriesEnriched} enriched)`
        )
      }
    }

    // Create collections
    if (collectionsToCreate.size > 0 && !isJobCancelled(jobId)) {
      setJobStep(jobId, 2, 'Creating collections', collectionsToCreate.size)
      addLog(jobId, 'info', `Creating ${collectionsToCreate.size} collections...`)

      for (const [tmdbId, data] of collectionsToCreate) {
        try {
          await upsertCollection(data)
          progress.collectionsCreated++
        } catch (err) {
          logger.error({ err, tmdbId }, 'Failed to create collection')
        }
      }

      // Update movie counts
      await updateCollectionCounts()
    }

    // Complete job
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    const totalProcessed = progress.moviesProcessed + progress.seriesProcessed
    const avgRate = (totalProcessed / parseFloat(totalDuration)).toFixed(1)

    const summary = `Enriched ${progress.moviesEnriched} movies (${progress.moviesFailed} failed), ${progress.seriesEnriched} series (${progress.seriesFailed} failed), created ${progress.collectionsCreated} collections in ${totalDuration}s (${avgRate}/sec)`
    addLog(jobId, 'info', `🎉 ${summary}`)
    
    // Mark run as completed
    await completeEnrichmentRun(runId, isJobCancelled(jobId) ? 'cancelled' : 'completed')
    
    completeJob(jobId, { progress })

    logger.info(progress, 'Metadata enrichment complete')
    return progress
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err }, 'Metadata enrichment failed')
    
    // Mark run as failed
    await completeEnrichmentRun(runId, 'failed')
    
    failJob(jobId, error)
    throw err
  }
}

/**
 * Get enrichment statistics
 */
export async function getEnrichmentStats(): Promise<{
  movies: { total: number; enriched: number; pending: number }
  series: { total: number; enriched: number; pending: number }
  collections: { total: number }
}> {
  const movieStats = await queryOne<{ total: string; enriched: string }>(
    `SELECT 
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE enriched_at IS NOT NULL) as enriched
     FROM movies`
  )

  const seriesStats = await queryOne<{ total: string; enriched: string }>(
    `SELECT 
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE enriched_at IS NOT NULL) as enriched
     FROM series`
  )

  const collectionStats = await queryOne<{ total: string }>(
    `SELECT COUNT(*) as total FROM collections`
  )

  const totalMovies = parseInt(movieStats?.total || '0', 10)
  const enrichedMovies = parseInt(movieStats?.enriched || '0', 10)
  const totalSeries = parseInt(seriesStats?.total || '0', 10)
  const enrichedSeries = parseInt(seriesStats?.enriched || '0', 10)

  return {
    movies: {
      total: totalMovies,
      enriched: enrichedMovies,
      pending: totalMovies - enrichedMovies,
    },
    series: {
      total: totalSeries,
      enriched: enrichedSeries,
      pending: totalSeries - enrichedSeries,
    },
    collections: {
      total: parseInt(collectionStats?.total || '0', 10),
    },
  }
}

/**
 * Clear enrichment data (for re-enriching)
 */
export async function clearEnrichmentData(): Promise<void> {
  await query(`UPDATE movies SET enriched_at = NULL, enrichment_version = 0, omdb_enriched_at = NULL`)
  await query(`UPDATE series SET enriched_at = NULL, enrichment_version = 0, omdb_enriched_at = NULL`)
  logger.info('Enrichment data cleared')
}

/**
 * Get enrichment version status
 * Returns current version and counts of items needing update
 *
 * `missingOmdb` is reported separately because the version counter cannot see
 * it: a row enriched without OMDb is stamped at the current version, so this
 * function used to report zero outdated items on a library where OMDb had
 * never run at all. Counted only for rows with an imdb_id, since OMDb is
 * looked up by that and a row without one is not missing anything obtainable.
 */
export async function getEnrichmentVersionStatus(): Promise<{
  currentVersion: number
  movies: { total: number; outdated: number; missingOmdb: number }
  series: { total: number; outdated: number; missingOmdb: number }
  needsUpdate: boolean
}> {
  // Get current version from system settings
  const versionResult = await queryOne<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'enrichment_version'`
  )
  const currentVersion = parseInt(versionResult?.value || '1', 10)

  // Count movies with outdated enrichment
  const movieStats = await queryOne<{ total: string; outdated: string; missing_omdb: string }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE enrichment_version < $1) as outdated,
       COUNT(*) FILTER (WHERE omdb_enriched_at IS NULL AND imdb_id IS NOT NULL) as missing_omdb
     FROM movies
     WHERE enriched_at IS NOT NULL`,
    [currentVersion]
  )

  // Count series with outdated enrichment
  const seriesStats = await queryOne<{ total: string; outdated: string; missing_omdb: string }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE enrichment_version < $1) as outdated,
       COUNT(*) FILTER (WHERE omdb_enriched_at IS NULL AND imdb_id IS NOT NULL) as missing_omdb
     FROM series
     WHERE enriched_at IS NOT NULL`,
    [currentVersion]
  )

  const movieOutdated = parseInt(movieStats?.outdated || '0', 10)
  const seriesOutdated = parseInt(seriesStats?.outdated || '0', 10)
  const movieMissingOmdb = parseInt(movieStats?.missing_omdb || '0', 10)
  const seriesMissingOmdb = parseInt(seriesStats?.missing_omdb || '0', 10)

  return {
    currentVersion,
    movies: {
      total: parseInt(movieStats?.total || '0', 10),
      outdated: movieOutdated,
      missingOmdb: movieMissingOmdb,
    },
    series: {
      total: parseInt(seriesStats?.total || '0', 10),
      outdated: seriesOutdated,
      missingOmdb: seriesMissingOmdb,
    },
    // Deliberately not folding in missingOmdb: with OMDb switched off those
    // rows are not "needing an update", they are simply not getting OMDb.
    needsUpdate: movieOutdated > 0 || seriesOutdated > 0,
  }
}

