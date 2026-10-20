/**
 * Studio Logo Enrichment Module
 *
 * Finds a logo for every studio and network the library names:
 * - Reads the media server's studio list first, with the image it holds for
 *   each (Thumb, else Primary). That image is the one Aperture shows, and the
 *   one the media server's own apps show.
 * - Looks TMDb up only for the names the media server has no image for, and
 *   stores those logos locally.
 *
 * Read-only towards the media server. It used to upload TMDb logos there as
 * each studio's Thumb, which replaced whatever image the studio already had
 * (Emby's built-in set included) without being able to see it first.
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
import { getTMDbConfig, getMediaServerApiKey } from '../settings/systemSettings.js'
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
  studioLogo,
  logoFileIsMissing,
  preferredLogoRows,
  type StudioLogo,
  type LogoMatchSource,
  type LogoOutcome,
  type LogoTally,
  type TmdbLogoEntity,
} from './studioLogoMatch.js'
import { getMediaServerProvider } from '../media/index.js'
import { getAbsolutePath } from '../uploads/storage.js'
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

/** How long one logo download may take, response body included */
const LOGO_DOWNLOAD_TIMEOUT_MS = 30_000

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
  /** Names the media server holds an image for, or null when it could not be read. */
  mediaServerImages: number | null
}

interface StudioToEnrich {
  id: string
  name: string
  type: 'studio' | 'network'
  emby_id: string | null
  logo_path: string | null
  logo_local_path: string | null
}

// ============================================================================
// Studio Population
// ============================================================================

/**
 * Populate the studios_networks table from movies and series
 * This extracts unique studios from the movies.studios and series.studios JSONB columns
 */
export async function populateStudiosFromMedia(): Promise<{ studios: number; networks: number }> {
  // Counts are rows inserted or changed: an existing row whose studio id is
  // unchanged is not rewritten, so the daily run leaves the table alone.
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
       updated_at = NOW()
     WHERE studios_networks.emby_id IS DISTINCT FROM COALESCE(EXCLUDED.emby_id, studios_networks.emby_id)`
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
       updated_at = NOW()
     WHERE studios_networks.emby_id IS DISTINCT FROM COALESCE(EXCLUDED.emby_id, studios_networks.emby_id)`
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
    `SELECT id, name, type, emby_id, logo_path, logo_local_path
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

async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(getAbsolutePath(relativePath))
    return true
  } catch {
    return false
  }
}

/** Delete a logo file this row no longer points at; a missing file is fine. */
async function removeLogoFile(relativePath: string): Promise<void> {
  try {
    await fs.unlink(getAbsolutePath(relativePath))
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

    // Bounded, because a stalled request would hold its worker forever: Stop
    // is polled only between logos, and the restore pass downloads thousands.
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(LOGO_DOWNLOAD_TIMEOUT_MS) })
    if (!response.ok) {
      logger.warn({ logoPath, status: response.status }, 'Failed to download logo')
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    // Save to uploads/studios directory
    // The uploads directory `/api/uploads/` serves. Logos were once written to
    // `./uploads` under the API's working directory, a folder nothing served
    // and a container recreate emptied; restoreMissingLogoFiles repairs those.
    const studiosDir = getAbsolutePath('studios')
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

interface LogoFileRestore {
  /** Rows holding a TMDb logo. */
  stored: number
  /** Of those, the rows whose local file was missing. */
  missing: number
  restored: number
  failed: number
}

/**
 * Download again every stored TMDb logo whose local file is gone, for the
 * names the media server has no image for (the others show the media
 * server's image, so their TMDb copy is not drawn anywhere).
 *
 * A row with a confirmed logo is never due a TMDb check again
 * (LOGO_CHECK_DUE_SQL), so nothing else would ever notice its file missing:
 * a container recreate, or the logos written before the uploads directory
 * was fixed, would leave every such row pointing at a 404 for good. This asks
 * TMDb nothing — the logo path is already known — and costs one image
 * download per missing file. A failure leaves the row as it was, and the next
 * run tries again.
 */
async function restoreMissingLogoFiles(jobId: string): Promise<LogoFileRestore> {
  const rows = (
    await query<{ id: string; name: string; logo_path: string; logo_local_path: string | null }>(
      `SELECT id, name, logo_path, logo_local_path
       FROM studios_networks
       WHERE logo_path IS NOT NULL AND media_image_type IS NULL
       ORDER BY name`
    )
  ).rows

  const presence = await processWithConcurrency(rows, 20, async (row) =>
    row.logo_local_path != null ? fileExists(row.logo_local_path) : false
  )
  const missing = rows.filter((row, i) => logoFileIsMissing(row.logo_local_path, presence[i]))
  const outcome: LogoFileRestore = { stored: rows.length, missing: missing.length, restored: 0, failed: 0 }
  if (missing.length === 0) return outcome

  addLog(jobId, 'info', `🩹 ${missing.length} of ${rows.length} stored logos have no file on disk; downloading them again...`)

  await processWithConcurrency(
    missing,
    CONCURRENCY,
    async (row) => {
      const localPath = await downloadLogo(row.logo_path, row.id)
      if (!localPath) {
        outcome.failed++
        return
      }
      await query(`UPDATE studios_networks SET logo_local_path = $2 WHERE id = $1`, [row.id, localPath])
      const leftOver = replacedLogoFile(row.logo_local_path, localPath)
      if (leftOver) await removeLogoFile(leftOver)
      outcome.restored++
    },
    () => isJobCancelled(jobId)
  )

  return outcome
}

interface MediaServerImageRead {
  /** Studios the media server lists. */
  listed: number
  /** Of those, the ones holding an image. */
  withImage: number
  /** Library studio and network names now known to have a media-server image. */
  namesWithImage: number
}

/**
 * Read the media server's studio list and record, on every row, the image it
 * holds for that name (or that it holds none).
 *
 * Names match exactly, which is how the media server named them in the first
 * place: every row comes from a studio name on a synced title. The studio's
 * own item id is stored too, since the one on a title's studio entry is not
 * always present.
 *
 * Returns null, and changes nothing, when the list cannot be read or comes
 * back empty: a server that answered nothing is not a server holding no
 * images, and clearing every row on its word would send the whole library to
 * TMDb.
 */
async function readMediaServerImages(jobId: string): Promise<MediaServerImageRead | null> {
  let studios
  try {
    const apiKey = await getMediaServerApiKey()
    if (!apiKey) {
      addLog(jobId, 'warn', 'No media server API key; using TMDb logos only')
      return null
    }
    const provider = await getMediaServerProvider()
    studios = await provider.getStudios(apiKey)
  } catch (err) {
    logger.warn({ err }, 'Failed to read the media server studio list')
    addLog(
      jobId,
      'warn',
      `Could not read the media server's studios (${err instanceof Error ? err.message : 'error'}); ` +
        'keeping what the last run recorded'
    )
    return null
  }
  if (studios.length === 0) {
    addLog(jobId, 'warn', 'The media server listed no studios; keeping what the last run recorded')
    return null
  }

  // One entry per name: a name listed twice keeps the copy holding an image.
  const byName = new Map<string, (typeof studios)[number]>()
  for (const studio of studios) {
    const held = byName.get(studio.name)
    if (!held || (!held.image && studio.image)) byName.set(studio.name, studio)
  }
  const entries = [...byName.values()]

  // Only rows whose recorded image changed, or that no read has covered yet,
  // are written: the read runs daily over every row, and rewriting thousands
  // of unchanged rows would only churn the table. The item id has its own
  // column (media_item_id), so the populate step's emby_id never competes
  // with it.
  await query(
    `WITH listed AS (
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
         AS l(name, item_id, image_type, image_tag)
     )
     UPDATE studios_networks sn SET
       media_item_id = l.item_id,
       media_image_type = l.image_type,
       media_image_tag = l.image_tag,
       media_images_read_at = NOW()
     FROM studios_networks sn_all
     LEFT JOIN listed l ON l.name = sn_all.name
     WHERE sn_all.id = sn.id
       AND (sn.media_images_read_at IS NULL
         OR sn.media_item_id IS DISTINCT FROM l.item_id
         OR sn.media_image_type IS DISTINCT FROM l.image_type
         OR sn.media_image_tag IS DISTINCT FROM l.image_tag)`,
    [
      entries.map((e) => e.name),
      entries.map((e) => e.id),
      entries.map((e) => e.image?.type ?? null),
      entries.map((e) => e.image?.tag ?? null),
    ]
  )
  // Names, not rows: a company on both films and shows has a row of each kind.
  const counted = await queryOne<{ names: string }>(
    `SELECT COUNT(DISTINCT name) AS names FROM studios_networks WHERE media_image_type IS NOT NULL`
  )

  return {
    listed: entries.length,
    withImage: entries.filter((e) => e.image).length,
    namesWithImage: Number.parseInt(counted?.names ?? '0', 10),
  }
}

interface EnrichResult {
  outcome: LogoOutcome
  source: LogoMatchSource | null
  /** The row held a logo before and now holds a different one, or none. */
  replacedLogo: boolean
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
  jobId: string
): Promise<EnrichResult> {
  const result: EnrichResult = {
    outcome: 'error',
    source: null,
    replacedLogo: false,
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

    await query(
      `UPDATE studios_networks SET
         tmdb_id = $2,
         logo_path = $3,
         origin_country = $4,
         logo_local_path = $5,
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
      async (row) => enrichStudio(row, titleIds, jobId),
      () => isJobCancelled(jobId)
    )

    // A cancel leaves holes where a row was never started.
    results.forEach((result, i) => {
      if (!result) return
      addOutcome(tally, result.outcome, result.source)
      if (result.outcome === 'error') failedRows++
      if (result.replacedLogo) tally.replaced++
      if (result.outcome === 'notFound') notFound.push(rows[i].name)
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
    mediaServerImages: null,
  }

  // Without TMDb the job still reads the media server's images; it only
  // skips the gap-filling.
  const tmdbConfig = await getTMDbConfig()
  const tmdbUsable = tmdbConfig.enabled && tmdbConfig.hasApiKey

  createJobProgress(jobId, 'enrich-studio-logos', 6)

  try {
    // Step 1: Populate studios from media
    setJobStep(jobId, 0, 'Extracting studios from media')
    addLog(jobId, 'info', '📋 Extracting studios and networks from movies/series...')

    const populated = await populateStudiosFromMedia()
    addLog(jobId, 'info', `✓ Found ${populated.studios} studios, ${populated.networks} networks`)

    // Step 2: What the media server holds. It decides which names TMDb is
    // asked about at all, so it comes before every TMDb step.
    setJobStep(jobId, 1, 'Reading studio images from the media server')
    const media = await readMediaServerImages(jobId)
    if (media) {
      progress.mediaServerImages = media.namesWithImage
      addLog(
        jobId,
        'info',
        `🖼 Media server: ${media.withImage} of ${media.listed} studios hold an image; ` +
          `${media.namesWithImage} of the library's studio and network names use it`
      )
    }
    if (isJobCancelled(jobId)) return progress

    if (!tmdbUsable) {
      addLog(jobId, 'warn', 'TMDb is not configured: names the media server has no image for get none')
      completeJob(jobId, { progress })
      return progress
    }

    // Step 3: Put back TMDb logo files that are gone, whether or not any row
    // is due a lookup, since no lookup ever revisits a confirmed logo.
    setJobStep(jobId, 2, 'Restoring missing logo files')
    const restore = await restoreMissingLogoFiles(jobId)
    addLog(
      jobId,
      restore.failed > 0 ? 'warn' : 'info',
      restore.missing === 0
        ? `✓ All ${restore.stored} TMDb logos in use have their file on disk`
        : `🩹 Restored ${restore.restored} of ${restore.missing} missing logo files` +
            (restore.failed > 0 ? ` (${restore.failed} downloads failed; the next run retries them)` : '')
    )
    if (isJobCancelled(jobId)) return progress

    const before = await getStudioLogoStats()
    const totalStudios = await countStudiosDue('studio')
    const totalNetworks = await countStudiosDue('network')
    addLog(
      jobId,
      'info',
      `📚 Now: studios ${before.studios.withLogos}/${before.studios.total} with a logo, ` +
        `networks ${before.networks.withLogos}/${before.networks.total} with a logo`
    )

    const totalItems = totalStudios + totalNetworks

    if (totalItems === 0) {
      addLog(
        jobId,
        'info',
        `✓ Nothing due on TMDb: every name has a media-server image, a confirmed logo, or was checked in the last ${LOGO_RECHECK_DAYS} days`
      )
      completeJob(jobId, { progress })
      return progress
    }

    addLog(
      jobId,
      'info',
      `🔍 Checking ${totalStudios} studios and ${totalNetworks} networks on TMDb: no media-server image, and ` +
        `never checked under the current lookup, or without a logo and last asked over ${LOGO_RECHECK_DAYS} days ago`
    )
    addLog(jobId, 'info', `⚡ Performance: ${CONCURRENCY} concurrent lookups`)

    const startTime = Date.now()

    // Step 4: Process studios
    if (totalStudios > 0) {
      setJobStep(jobId, 3, 'Looking up studios on TMDb', totalItems)
      await enrichKind(
        'studio',
        totalStudios,
        { jobId, startTime, doneBefore: 0, totalItems },
        progress
      )
    }

    // Step 5: Process networks
    if (totalNetworks > 0 && !isJobCancelled(jobId)) {
      setJobStep(jobId, 4, 'Looking up networks on TMDb', totalItems)
      await enrichKind(
        'network',
        totalNetworks,
        { jobId, startTime, doneBefore: progress.studios.checked, totalItems },
        progress
      )
    }

    progress.studiosEnriched = progress.studios.logo
    progress.networksEnriched = progress.networks.logo

    // Step 6: Report
    setJobStep(jobId, 5, 'Summarising')
    const after = await getStudioLogoStats()
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    addLog(
      jobId,
      'info',
      `🎉 Done in ${totalDuration}s. Library now: studios ${after.studios.withLogos}/${after.studios.total} ` +
        `with a logo, networks ${after.networks.withLogos}/${after.networks.total} with a logo ` +
        `(${after.mediaServerImages} names use the media server's image, the rest TMDb's).`
    )

    if (isJobCancelled(jobId)) return progress
    completeJob(jobId, { progress })

    logger.info(
      { studios: progress.studios, networks: progress.networks, mediaServerImages: progress.mediaServerImages },
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
 * How many studios and networks have a logo to show, from either source. A
 * name with a media-server image counts whether or not TMDb has one.
 */
export async function getStudioLogoStats(): Promise<{
  studios: { total: number; withLogos: number; pending: number }
  networks: { total: number; withLogos: number; pending: number }
  /** Distinct names whose logo comes from the media server. */
  mediaServerImages: number
}> {
  const [rows, media] = await Promise.all([
    query<{ type: string; total: string; with_logos: string }>(
      `SELECT type,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE media_image_type IS NOT NULL OR logo_path IS NOT NULL) AS with_logos
       FROM studios_networks
       GROUP BY type`
    ).then((r) => r.rows),
    // Names, not rows: a company on both films and shows has a row of each kind.
    queryOne<{ names: string }>(
      `SELECT COUNT(DISTINCT name) AS names FROM studios_networks WHERE media_image_type IS NOT NULL`
    ),
  ])
  const of = (type: string) => {
    const row = rows.find((r) => r.type === type)
    const total = Number.parseInt(row?.total ?? '0', 10)
    const withLogos = Number.parseInt(row?.with_logos ?? '0', 10)
    return { total, withLogos, pending: total - withLogos }
  }
  return {
    studios: of('studio'),
    networks: of('network'),
    mediaServerImages: Number.parseInt(media?.names ?? '0', 10),
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

/** A studio row's logo columns, as every reader selects them. */
export interface StudioLogoRow {
  /** The studio id on a title's studio entry; only guessed at before any read. */
  emby_id: string | null
  media_item_id: string | null
  media_image_type: string | null
  media_image_tag: string | null
  media_images_read_at: Date | null
  logo_local_path: string | null
  logo_path: string | null
}

const STUDIO_LOGO_COLUMNS = [
  'emby_id',
  'media_item_id',
  'media_image_type',
  'media_image_tag',
  'media_images_read_at',
  'logo_local_path',
  'logo_path',
] as const satisfies readonly (keyof StudioLogoRow)[]

/** The columns a reader selects for `resolveStudioLogo`, with a table alias. */
export function studioLogoColumns(alias: string): string {
  return STUDIO_LOGO_COLUMNS.map((c) => `${alias}.${c}`).join(', ')
}

/**
 * The logo a page shows for this row, or null when there is none: the media
 * server's image first, then the TMDb logo (`studioLogo`). Every page showing
 * a studio or network logo goes through here. The local file is only looked
 * for when the media server has no image.
 */
export async function resolveStudioLogo(row: StudioLogoRow): Promise<StudioLogo | null> {
  const hasMediaImage =
    row.media_item_id != null && row.media_image_type != null && row.media_image_tag != null
  return studioLogo({
    mediaRead: row.media_images_read_at != null,
    mediaItemId: row.media_item_id,
    mediaImageType: row.media_image_type,
    mediaImageTag: row.media_image_tag,
    titleStudioId: row.emby_id,
    localPath: row.logo_local_path,
    localFileExists:
      !hasMediaImage && row.logo_local_path != null && (await fileExists(row.logo_local_path)),
    tmdbPath: row.logo_path,
  })
}

/**
 * Logos for a set of names, keyed by the name exactly as asked.
 *
 * Names match exactly, as the Watch Stats join does. A name stored as both a
 * studio and a network answers with the `prefer` kind's row when it has a
 * logo, the other's otherwise: a series' studios are filed as networks (the
 * populate step reads `series.studios` as networks), so a film company named
 * on a show is still found. Names without a logo are absent from the map.
 * A row of the preferred kind that resolves to nothing gives way to the other
 * kind's row.
 */
export async function getStudioLogos(
  names: readonly string[],
  prefer: 'studio' | 'network'
): Promise<Map<string, StudioLogo>> {
  const wanted = [...new Set(names.filter((n) => n.trim() !== ''))]
  const logos = new Map<string, StudioLogo>()
  if (wanted.length === 0) return logos

  const rows = (
    await query<StudioLogoRow & { name: string; type: string }>(
      `SELECT sn.name, sn.type, ${studioLogoColumns('sn')}
       FROM studios_networks sn
       WHERE sn.name = ANY($1::text[])`,
      [wanted]
    )
  ).rows

  const resolved = await Promise.all(
    rows.map(async (row) => ({ ...row, logo: await resolveStudioLogo(row) }))
  )
  for (const [name, row] of preferredLogoRows(
    resolved.filter((r) => r.logo != null),
    prefer
  )) {
    if (row.logo) logos.set(name, row.logo)
  }
  return logos
}
