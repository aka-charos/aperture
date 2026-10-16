/**
 * Studio Logo Enrichment Module
 *
 * Enriches studios and networks with TMDB logo data:
 * - Fetches production company/network logos from TMDB
 * - Downloads and stores logos locally
 * - Optionally pushes logos to Emby/Jellyfin
 *
 * PERFORMANCE OPTIMIZED:
 * - Multiple studios processed concurrently (within API rate limits)
 * - TMDb: ~40 req/sec (limit is ~50)
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
import { getTMDbConfig, getSystemSetting } from '../settings/systemSettings.js'
import { searchCompanyByName, getImageUrl, type ApiLogCallback } from '../tmdb/client.js'
import { getMovieDetails } from '../tmdb/movies.js'
import { getTVDetails } from '../tmdb/series.js'
import {
  addOutcome,
  describeTally,
  emptyTally,
  findEntityByName,
  LOGO_CHECK_DUE_SQL,
  LOGO_RECHECK_DAYS,
  replacedLogoFile,
  type LogoMatchSource,
  type LogoOutcome,
  type LogoTally,
  type TmdbLogoEntity,
} from './studioLogoMatch.js'
import { pushImageToMediaServer } from '../uploads/mediaServerSync.js'
import * as fs from 'fs/promises'
import * as path from 'path'

const logger = createChildLogger('enrichment:studio-logos')

// ============================================================================
// PERFORMANCE TUNING CONSTANTS
// ============================================================================

/** Number of studios to process concurrently */
const CONCURRENCY = 5

/** Number of studios to fetch per database query */
const BATCH_SIZE = 50

/** How many not-found names the report lists per kind */
const NOT_FOUND_SAMPLE = 40

// ============================================================================
// Types
// ============================================================================

interface StudioLogoProgress {
  studios: LogoTally
  networks: LogoTally
  /** Logos stored this run (kept for the executor's summary line). */
  studiosEnriched: number
  networksEnriched: number
  logosPushedToEmby: number
}

interface StudioToEnrich {
  id: string
  name: string
  type: 'studio' | 'network'
  emby_id: string | null
  logo_path: string | null
  logo_local_path: string | null
  emby_synced_at: Date | null
}

// ============================================================================
// Studio Population
// ============================================================================

/**
 * Populate the studios_networks table from movies and series
 * This extracts unique studios from the movies.studios and series.studios JSONB columns
 */
export async function populateStudiosFromMedia(): Promise<{ studios: number; networks: number }> {
  logger.info('Populating studios_networks table from media...')

  // Group by (name, type) — DISTINCT on emby_id too would leave duplicate conflict keys
  // when the same studio name appears with different Emby IDs across titles.
  const studioResult = await query(
    `INSERT INTO studios_networks (name, type, emby_id)
     SELECT
       name,
       'studio' as type,
       MAX(emby_id) as emby_id
     FROM (
       SELECT
         studio_obj->>'name' as name,
         studio_obj->>'id' as emby_id
       FROM movies, jsonb_array_elements(studios) as studio_obj
       WHERE studio_obj->>'name' IS NOT NULL
         AND studio_obj->>'name' != ''
     ) studios
     GROUP BY name
     ON CONFLICT (name, type) DO UPDATE SET
       emby_id = COALESCE(EXCLUDED.emby_id, studios_networks.emby_id),
       updated_at = NOW()`
  )

  // Insert unique studios/networks from series
  // For series, we treat them as 'network' type since that's more commonly what they represent
  const networkResult = await query(
    `INSERT INTO studios_networks (name, type, emby_id)
     SELECT
       name,
       'network' as type,
       MAX(emby_id) as emby_id
     FROM (
       SELECT
         studio_obj->>'name' as name,
         studio_obj->>'id' as emby_id
       FROM series, jsonb_array_elements(studios) as studio_obj
       WHERE studio_obj->>'name' IS NOT NULL
         AND studio_obj->>'name' != ''
     ) networks
     GROUP BY name
     ON CONFLICT (name, type) DO UPDATE SET
       emby_id = COALESCE(EXCLUDED.emby_id, studios_networks.emby_id),
       updated_at = NOW()`
  )

  const studiosCount = studioResult.rowCount || 0
  const networksCount = networkResult.rowCount || 0

  logger.info({ studios: studiosCount, networks: networksCount }, 'Studios/networks populated')
  return { studios: studiosCount, networks: networksCount }
}

// ============================================================================
// Studio Logo Enrichment
// ============================================================================

/**
 * Rows of one kind that are due a lookup (LOGO_CHECK_DUE_SQL), in name order.
 */
async function getStudiosNeedingLogos(
  type: 'studio' | 'network',
  limit: number = 50,
  offset: number = 0
): Promise<StudioToEnrich[]> {
  const result = await query<StudioToEnrich>(
    `SELECT id, name, type, emby_id, logo_path, logo_local_path, emby_synced_at
     FROM studios_networks
     WHERE type = $1
       AND ${LOGO_CHECK_DUE_SQL}
     ORDER BY name
     LIMIT $2
     OFFSET $3`,
    [type, limit, offset]
  )
  return result.rows
}

/** How many rows of one kind are due a lookup — the same rule as the selection. */
async function countStudiosDue(type: 'studio' | 'network'): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM studios_networks WHERE type = $1 AND ${LOGO_CHECK_DUE_SQL}`,
    [type]
  )
  return Number.parseInt(row?.count ?? '0', 10)
}

function uploadsDir(): string {
  return process.env.UPLOADS_DIR || './uploads'
}

async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(uploadsDir(), relativePath))
    return true
  } catch {
    return false
  }
}

/** Delete a logo file this row no longer points at; a missing file is fine. */
async function removeLogoFile(relativePath: string): Promise<void> {
  try {
    await fs.unlink(path.join(uploadsDir(), relativePath))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ err, relativePath }, 'Failed to remove replaced studio logo')
    }
  }
}

/**
 * Download logo from TMDB and save locally
 */
async function downloadLogo(
  logoPath: string,
  studioId: string
): Promise<string | null> {
  try {
    const imageUrl = getImageUrl(logoPath, 'w185')
    if (!imageUrl) return null

    const response = await fetch(imageUrl)
    if (!response.ok) {
      logger.warn({ logoPath, status: response.status }, 'Failed to download logo')
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    // Save to uploads/studios directory
    const studiosDir = path.join(uploadsDir(), 'studios')
    await fs.mkdir(studiosDir, { recursive: true })

    const ext = path.extname(logoPath) || '.png'
    const filename = `${studioId}${ext}`
    const filePath = path.join(studiosDir, filename)

    await fs.writeFile(filePath, buffer)
    
    // Return relative path for database storage
    return `studios/${filename}`
  } catch (err) {
    logger.error({ err, logoPath }, 'Failed to download logo')
    return null
  }
}

interface EnrichResult {
  outcome: LogoOutcome
  source: LogoMatchSource | null
  /** The row held a logo before and now holds a different one, or none. */
  replacedLogo: boolean
  pushedToEmby: boolean
}

type Resolution =
  | { kind: 'found'; entity: TmdbLogoEntity; source: LogoMatchSource }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }

/**
 * For every name of this kind that a library title credits, the TMDb id of one
 * such title (a movie for a studio, a series for a network). One scan per run
 * rather than one per row: `studios` has no index, and a row-by-row lookup was
 * a sequential scan of the whole table for each of thousands of rows.
 */
async function loadCreditingTitleIds(type: 'studio' | 'network'): Promise<Map<string, number>> {
  const table = type === 'network' ? 'series' : 'movies'
  const result = await query<{ name: string; tmdb_id: string }>(
    `SELECT DISTINCT ON (s->>'name') s->>'name' AS name, t.tmdb_id
     FROM ${table} t, jsonb_array_elements(t.studios) s
     WHERE t.tmdb_id ~ '^[0-9]+$'
       AND COALESCE(s->>'name', '') <> ''
     ORDER BY s->>'name', t.tmdb_id::bigint`
  )
  return new Map(result.rows.map((r) => [r.name, Number.parseInt(r.tmdb_id, 10)]))
}

/** A TMDb log callback that remembers the last failed request. */
function failureTracker(): { onLog: ApiLogCallback; failed: () => string | null } {
  let message: string | null = null
  return {
    onLog: (_service, endpoint, status, details) => {
      if (status === 'error') message = `${endpoint.split('?')[0]}: ${details ?? 'failed'}`
    },
    failed: () => message,
  }
}

/**
 * Resolve a studio/network to a TMDb entity by name.
 *
 * First through a title that credits it: that title's TMDb details list the
 * companies (and, for a series, the networks) with their real ids and logos.
 * This is the only way to reach a NETWORK — TMDb has no network search, and
 * the company search answers "HBO" with HBO the production company, if
 * anything. Then the company search, exact name only.
 *
 * A failed request is an ERROR, never a reason to try the next way: falling
 * through to the company search after the title lookup failed would store a
 * company's logo on a network row whenever TMDb had a bad moment. A title TMDb
 * no longer has (404) is not a failure and does fall through.
 *
 * A stored tmdb_id is deliberately not reused: on a network row it was written
 * by the company search, so looking it up as a network fetched an unrelated
 * network's logo.
 */
async function resolveEntity(
  studio: StudioToEnrich,
  titleIds: Map<string, number>
): Promise<Resolution> {
  const titleId = titleIds.get(studio.name)
  if (titleId != null) {
    const tracker = failureTracker()
    const candidates: TmdbLogoEntity[] = []
    if (studio.type === 'network') {
      const details = await getTVDetails(titleId, { onLog: tracker.onLog })
      // Networks first: Emby files a show's network under Studios, and a
      // network and a company can share a name with different logos.
      candidates.push(...(details?.networks ?? []), ...(details?.production_companies ?? []))
    } else {
      const details = await getMovieDetails(titleId, { onLog: tracker.onLog })
      candidates.push(...(details?.production_companies ?? []))
    }
    const failed = tracker.failed()
    if (failed) return { kind: 'error', message: failed }
    const match = findEntityByName(studio.name, candidates)
    if (match) return { kind: 'found', entity: match, source: 'title' }
  }

  const tracker = failureTracker()
  const searched = await searchCompanyByName(studio.name, { onLog: tracker.onLog })
  const failed = tracker.failed()
  if (failed) return { kind: 'error', message: failed }
  const match = findEntityByName(studio.name, searched ? [searched] : [])
  return match ? { kind: 'found', entity: match, source: 'search' } : { kind: 'notFound' }
}

/**
 * Look one studio/network up and store the answer.
 *
 * Every answer TMDb gives is stored and stamped `logo_checked_at`, "not found"
 * included, which CLEARS a logo the row held: the lookup rules are stricter
 * than the ones that stored it, so a logo they cannot confirm was another
 * company's. Only a failure stores nothing, leaving the row due again.
 */
async function enrichStudio(
  studio: StudioToEnrich,
  titleIds: Map<string, number>,
  pushToEmby: boolean,
  jobId: string
): Promise<EnrichResult> {
  const result: EnrichResult = {
    outcome: 'error',
    source: null,
    replacedLogo: false,
    pushedToEmby: false,
  }

  try {
    const resolution = await resolveEntity(studio, titleIds)

    if (resolution.kind === 'error') {
      addLog(jobId, 'warn', `✗ ${studio.name}: TMDb request failed (${resolution.message})`)
      return result
    }

    const entity = resolution.kind === 'found' ? resolution.entity : null
    const logoPath = entity?.logo_path ?? null
    if (resolution.kind === 'found') result.source = resolution.source

    // The same TMDb logo already on disk is kept rather than fetched again,
    // which matters on the first run after 0204, when every stored logo is
    // checked once.
    let localPath: string | null = null
    if (logoPath) {
      const unchanged =
        logoPath === studio.logo_path &&
        studio.logo_local_path != null &&
        (await fileExists(studio.logo_local_path))
      localPath = unchanged ? studio.logo_local_path : await downloadLogo(logoPath, studio.id)
      if (!localPath) {
        addLog(jobId, 'warn', `✗ ${studio.name}: logo download failed`)
        return result
      }
    }

    // The SET list reads the row as it was, so the CASE compares against the
    // old logo: a changed logo has not been pushed to the media server yet.
    await query(
      `UPDATE studios_networks SET
         tmdb_id = $2,
         logo_path = $3,
         origin_country = $4,
         logo_local_path = $5,
         emby_synced_at = CASE WHEN logo_path IS DISTINCT FROM $3 THEN NULL ELSE emby_synced_at END,
         logo_checked_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [studio.id, entity?.id ?? null, logoPath, entity?.origin_country || null, localPath]
    )

    const leftOver = replacedLogoFile(studio.logo_local_path, localPath)
    if (leftOver) await removeLogoFile(leftOver)
    result.replacedLogo = studio.logo_path != null && studio.logo_path !== logoPath
    if (result.replacedLogo) {
      addLog(
        jobId,
        'info',
        `↺ ${studio.name}: stored logo ${logoPath ? 'replaced' : 'removed'} (it was not this ${studio.type}'s on TMDb)`
      )
    }

    if (!entity) {
      result.outcome = 'notFound'
      addLog(jobId, 'debug', `○ ${studio.name}: not found on TMDb`)
      return result
    }

    if (!logoPath) {
      result.outcome = 'noLogo'
      addLog(jobId, 'debug', `○ ${studio.name}: on TMDb (#${entity.id}) without a logo`)
      return result
    }

    result.outcome = 'logo'
    addLog(jobId, 'debug', `✓ ${studio.name}: logo found (${result.source})`)

    // Push to Emby if enabled, we have an Emby ID, and this logo is not there yet
    const alreadyPushed = !result.replacedLogo && studio.emby_synced_at != null
    if (pushToEmby && localPath && studio.emby_id && !alreadyPushed) {
      try {
        const buffer = await fs.readFile(path.join(uploadsDir(), localPath))
        const ext = path.extname(localPath).toLowerCase()
        const mimeType = ext === '.svg' ? 'image/svg+xml' : 'image/png'

        const pushResult = await pushImageToMediaServer(
          studio.emby_id,
          'Thumb', // Studio images use 'Thumb' type in Emby
          buffer,
          mimeType
        )

        if (pushResult.success) {
          await query(`UPDATE studios_networks SET emby_synced_at = NOW() WHERE id = $1`, [
            studio.id,
          ])
          result.pushedToEmby = true
          addLog(jobId, 'debug', `🖼 Pushed logo to Emby: ${studio.name}`)
        }
      } catch (err) {
        logger.warn({ err, studioId: studio.id, name: studio.name }, 'Failed to push logo to Emby')
      }
    }
  } catch (err) {
    logger.error({ err, studioId: studio.id }, 'Failed to enrich studio')
    addLog(jobId, 'warn', `✗ ${studio.name}: ${err instanceof Error ? err.message : 'error'}`)
    result.outcome = 'error'
  }

  return result
}

// ============================================================================
// Concurrent Processing Helper
// ============================================================================

/**
 * Process items with limited concurrency
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
 * Work through every pending row of one kind, reporting each batch and,
 * at the end, how the whole kind ended.
 */
async function enrichKind(
  type: 'studio' | 'network',
  total: number,
  ctx: {
    jobId: string
    pushToEmby: boolean
    startTime: number
    doneBefore: number
    totalItems: number
  },
  progress: StudioLogoProgress
): Promise<void> {
  const { jobId } = ctx
  const label = type === 'studio' ? 'Studios' : 'Networks'
  const icon = type === 'studio' ? '🏢' : '📺'
  const tally = type === 'studio' ? progress.studios : progress.networks
  const notFound: string[] = []
  // Every answer stamps logo_checked_at and takes the row out of the due set;
  // only a failure leaves it there, and failed rows all sort before the rows
  // not reached yet, so the failures are the offset of the next batch.
  let failedRows = 0

  addLog(jobId, 'info', `${icon} Processing ${total} ${label.toLowerCase()}...`)
  const titleIds = await loadCreditingTitleIds(type)

  while (true) {
    if (isJobCancelled(jobId)) {
      addLog(jobId, 'warn', 'Job cancelled by user')
      break
    }

    const rows = await getStudiosNeedingLogos(type, BATCH_SIZE, failedRows)
    if (rows.length === 0) break

    const results = await processWithConcurrency(
      rows,
      CONCURRENCY,
      async (row) => enrichStudio(row, titleIds, ctx.pushToEmby, jobId),
      () => isJobCancelled(jobId)
    )

    // A cancel leaves holes where a row was never started.
    results.forEach((result, i) => {
      if (!result) return
      addOutcome(tally, result.outcome, result.source)
      if (result.outcome === 'error') failedRows++
      if (result.replacedLogo) tally.replaced++
      if (result.outcome === 'notFound') notFound.push(rows[i].name)
      if (result.pushedToEmby) progress.logosPushedToEmby++
    })

    const done = ctx.doneBefore + tally.checked
    updateJobProgress(jobId, done, ctx.totalItems)

    const elapsed = (Date.now() - ctx.startTime) / 1000
    addLog(
      jobId,
      'info',
      `${icon} ${label}: ${tally.checked}/${total} (${(done / elapsed).toFixed(1)}/sec) — ` +
        `${tally.logo} logo, ${tally.noLogo} no logo on TMDb, ${tally.notFound} not found, ${tally.error} failed`
    )
  }

  addLog(jobId, 'info', `📊 ${describeTally(label, tally)}`)
  if (notFound.length > 0) {
    const shown = notFound.slice(0, NOT_FOUND_SAMPLE)
    const more = notFound.length - shown.length
    addLog(
      jobId,
      'info',
      `${label} not found on TMDb: ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`
    )
  }
}

/**
 * Run the studio logo enrichment job
 */
export async function enrichStudioLogos(jobId: string): Promise<StudioLogoProgress> {
  const progress: StudioLogoProgress = {
    studios: emptyTally(),
    networks: emptyTally(),
    studiosEnriched: 0,
    networksEnriched: 0,
    logosPushedToEmby: 0,
  }

  // Check if TMDb is configured
  const tmdbConfig = await getTMDbConfig()
  if (!tmdbConfig.enabled || !tmdbConfig.hasApiKey) {
    logger.warn('TMDb is not configured - skipping studio logo enrichment')
    return progress
  }

  // Check push to Emby setting
  const pushToEmby = (await getSystemSetting('studio_logos_push_to_emby')) === 'true'

  createJobProgress(jobId, 'enrich-studio-logos', 4)

  try {
    // Step 1: Populate studios from media
    setJobStep(jobId, 0, 'Extracting studios from media')
    addLog(jobId, 'info', '📋 Extracting studios and networks from movies/series...')

    const populated = await populateStudiosFromMedia()
    addLog(jobId, 'info', `✓ Found ${populated.studios} studios, ${populated.networks} networks`)

    const before = await getStudioLogoStats()
    const totalStudios = await countStudiosDue('studio')
    const totalNetworks = await countStudiosDue('network')
    addLog(
      jobId,
      'info',
      `📚 Before this run: studios ${before.studios.withLogos}/${before.studios.total} with logos, ` +
        `networks ${before.networks.withLogos}/${before.networks.total} with logos`
    )

    const totalItems = totalStudios + totalNetworks

    if (totalItems === 0) {
      addLog(
        jobId,
        'info',
        `✓ Nothing due: every studio/network has a confirmed logo or was checked in the last ${LOGO_RECHECK_DAYS} days`
      )
      completeJob(jobId, { progress })
      return progress
    }

    addLog(
      jobId,
      'info',
      `🔍 Checking ${totalStudios} studios and ${totalNetworks} networks: never checked under the ` +
        `current lookup, or without a logo and last asked over ${LOGO_RECHECK_DAYS} days ago`
    )
    addLog(jobId, 'info', `⚡ Performance: ${CONCURRENCY} concurrent lookups`)
    addLog(jobId, 'info', `📤 Push to Emby: ${pushToEmby ? 'enabled' : 'disabled'}`)

    const startTime = Date.now()

    // Step 2: Process studios
    if (totalStudios > 0) {
      setJobStep(jobId, 1, 'Enriching studios', totalItems)
      await enrichKind(
        'studio',
        totalStudios,
        { jobId, pushToEmby, startTime, doneBefore: 0, totalItems },
        progress
      )
    }

    // Step 3: Process networks
    if (totalNetworks > 0 && !isJobCancelled(jobId)) {
      setJobStep(jobId, 2, 'Enriching networks', totalItems)
      await enrichKind(
        'network',
        totalNetworks,
        { jobId, pushToEmby, startTime, doneBefore: progress.studios.checked, totalItems },
        progress
      )
    }

    progress.studiosEnriched = progress.studios.logo
    progress.networksEnriched = progress.networks.logo

    // Step 4: Report
    setJobStep(jobId, 3, 'Summarising')
    const after = await getStudioLogoStats()
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    addLog(
      jobId,
      'info',
      `🎉 Done in ${totalDuration}s. Library now: studios ${after.studios.withLogos}/${after.studios.total} ` +
        `with logos, networks ${after.networks.withLogos}/${after.networks.total} with logos. ` +
        `${progress.logosPushedToEmby} pushed to Emby.`
    )

    if (isJobCancelled(jobId)) return progress
    completeJob(jobId, { progress })

    logger.info(
      { studios: progress.studios, networks: progress.networks, pushed: progress.logosPushedToEmby },
      'Studio logo enrichment complete'
    )
    return progress
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err }, 'Studio logo enrichment failed')
    failJob(jobId, error)
    throw err
  }
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get studio logo enrichment statistics
 */
export async function getStudioLogoStats(): Promise<{
  studios: { total: number; withLogos: number; pending: number }
  networks: { total: number; withLogos: number; pending: number }
  pushedToEmby: number
}> {
  const studioStats = await queryOne<{ total: string; with_logos: string }>(
    `SELECT 
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE logo_path IS NOT NULL) as with_logos
     FROM studios_networks
     WHERE type = 'studio'`
  )

  const networkStats = await queryOne<{ total: string; with_logos: string }>(
    `SELECT 
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE logo_path IS NOT NULL) as with_logos
     FROM studios_networks
     WHERE type = 'network'`
  )

  const embyStats = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM studios_networks WHERE emby_synced_at IS NOT NULL`
  )

  const totalStudios = parseInt(studioStats?.total || '0', 10)
  const studiosWithLogos = parseInt(studioStats?.with_logos || '0', 10)
  const totalNetworks = parseInt(networkStats?.total || '0', 10)
  const networksWithLogos = parseInt(networkStats?.with_logos || '0', 10)

  return {
    studios: {
      total: totalStudios,
      withLogos: studiosWithLogos,
      pending: totalStudios - studiosWithLogos,
    },
    networks: {
      total: totalNetworks,
      withLogos: networksWithLogos,
      pending: totalNetworks - networksWithLogos,
    },
    pushedToEmby: parseInt(embyStats?.count || '0', 10),
  }
}

/**
 * Get studio/network by name for display
 */
export async function getStudioByName(
  name: string,
  type: 'studio' | 'network'
): Promise<{
  id: string
  name: string
  tmdbId: number | null
  logoPath: string | null
  logoLocalPath: string | null
  embyId: string | null
} | null> {
  const result = await queryOne<{
    id: string
    name: string
    tmdb_id: number | null
    logo_path: string | null
    logo_local_path: string | null
    emby_id: string | null
  }>(
    `SELECT id, name, tmdb_id, logo_path, logo_local_path, emby_id
     FROM studios_networks
     WHERE name = $1 AND type = $2`,
    [name, type]
  )

  if (!result) return null

  return {
    id: result.id,
    name: result.name,
    tmdbId: result.tmdb_id,
    logoPath: result.logo_path,
    logoLocalPath: result.logo_local_path,
    embyId: result.emby_id,
  }
}

/**
 * Get logo URL for a studio/network
 * Returns local path if available, otherwise TMDB URL
 */
export function getStudioLogoUrl(
  logoLocalPath: string | null,
  logoPath: string | null
): string | null {
  if (logoLocalPath) {
    // Return API endpoint for local image
    return `/api/images/studios/${logoLocalPath.replace('studios/', '')}`
  }
  if (logoPath) {
    // Return TMDB URL
    return getImageUrl(logoPath, 'w185')
  }
  return null
}

