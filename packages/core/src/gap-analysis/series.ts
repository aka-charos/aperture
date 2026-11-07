/**
 * TV gap analysis: the aired seasons a show has that the library does not hold.
 *
 * Same shape as the movie scan: a job compares and persists, and pages read SQL with
 * no TMDb or Seerr call. A snapshot is replaced only by a finished one, so a failed
 * or cancelled scan leaves the last good list up. See `seriesRules.ts` for the rules.
 */

import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { addLog, isJobCancelled, setJobStep, updateJobProgress } from '../jobs/progress.js'
import { batchGetSeasonStatuses, isSeerrConfigured } from '../seerr/provider.js'
import { tmdbLookup } from '../tmdb/client.js'
import {
  compareShowSeasons,
  decideSeriesGapShow,
  showNetworks,
  type ActiveSeriesRequest,
  type SeriesGapShow,
  type StoredSeason,
  type TmdbLastEpisode,
  type TmdbSeason,
} from './seriesRules.js'
import {
  scanFailureReason,
  scanRunStore,
  tmdbSilenceGuard,
  unreadableAllowed,
  type ScanFailureReason,
} from './scanRuns.js'

const logger = createChildLogger('gap-analysis-series')

const CHUNK_SIZE = 20
const runs = scanRunStore({ runs: 'gap_analysis_series_runs', results: 'gap_analysis_series_results' })
/** A request still on its way; once finished, the next sync or scan has the truth. */
const IN_FLIGHT_REQUEST_STATUSES = ['pending', 'submitted', 'approved']

interface TmdbShow {
  poster_path: string | null
  seasons?: TmdbSeason[] | null
  networks?: { name?: string | null }[] | null
  last_episode_to_air?: TmdbLastEpisode | null
}

export interface SeriesGapRun {
  id: string
  status: 'running' | 'completed' | 'failed'
  errorMessage: string | null
  failureReason: ScanFailureReason | null
  showsTotal: number
  showsScanned: number
  showsListed: number
  showsNumberingDiffers: number
  showsNotOnTmdb: number
  lookupsFailed: number
  showsWithoutTmdbId: number
  airedSeasons: number
  ownedSeasons: number
  missingSeasons: number
  partialSeasons: number
  startedAt: Date
  completedAt: Date | null
}

type RunRow = {
  id: string
  status: SeriesGapRun['status']
  error_message: string | null
  shows_total: number
  shows_scanned: number
  shows_listed: number
  shows_numbering_differs: number
  shows_not_on_tmdb: number
  lookups_failed: number
  shows_without_tmdb_id: number
  aired_seasons: number
  owned_seasons: number
  missing_seasons: number
  partial_seasons: number
  started_at: Date
  completed_at: Date | null
}

function toRun(row: RunRow): SeriesGapRun {
  return {
    id: row.id,
    status: row.status,
    errorMessage: row.error_message,
    failureReason: scanFailureReason(row.error_message),
    showsTotal: row.shows_total,
    showsScanned: row.shows_scanned,
    showsListed: row.shows_listed,
    showsNumberingDiffers: row.shows_numbering_differs,
    showsNotOnTmdb: row.shows_not_on_tmdb,
    lookupsFailed: row.lookups_failed,
    showsWithoutTmdbId: row.shows_without_tmdb_id,
    airedSeasons: row.aired_seasons,
    ownedSeasons: row.owned_seasons,
    missingSeasons: row.missing_seasons,
    partialSeasons: row.partial_seasons,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function getLatestCompletedSeriesGapRun(): Promise<SeriesGapRun | null> {
  const row = await queryOne<RunRow>(
    `SELECT * FROM gap_analysis_series_runs
     WHERE status = 'completed'
     ORDER BY completed_at DESC LIMIT 1`
  )
  return row ? toRun(row) : null
}

export async function getActiveSeriesGapRun(): Promise<SeriesGapRun | null> {
  const row = await queryOne<RunRow>(
    `SELECT * FROM gap_analysis_series_runs
     WHERE status = 'running'
     ORDER BY started_at DESC LIMIT 1`
  )
  return row ? toRun(row) : null
}

/** The scan that failed since the last good one, so the page can say so. */
export async function getFailedSeriesGapRun(): Promise<SeriesGapRun | null> {
  const row = await runs.latestFailed<RunRow>()
  return row ? toRun(row) : null
}

/** At boot and after a restore, never from a read; see `closeInterrupted` in `scanRuns.ts`. */
export async function closeInterruptedSeriesGapRuns(): Promise<void> {
  await runs.closeInterrupted()
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export async function getSeriesGapPrerequisites(): Promise<{ showsWithTmdbId: number; showsWithoutTmdbId: number }> {
  const row = await queryOne<{ with_id: number; without_id: number }>(
    `SELECT COUNT(DISTINCT tmdb_id) FILTER (WHERE tmdb_id ~ '^[0-9]+$')::int AS with_id,
            COUNT(*) FILTER (WHERE tmdb_id IS NULL OR tmdb_id !~ '^[0-9]+$')::int AS without_id
     FROM series`
  )
  return { showsWithTmdbId: row?.with_id ?? 0, showsWithoutTmdbId: row?.without_id ?? 0 }
}

/** How far the library has moved under a snapshot. */
export async function countEpisodesAddedSince(when: Date): Promise<number> {
  const row = await queryOne<{ c: number }>(`SELECT COUNT(*)::int AS c FROM episodes WHERE created_at > $1`, [when])
  return row?.c ?? 0
}

interface LibraryShow {
  tmdbId: number
  title: string
  network: string | null
}

/** One entry per show: two libraries holding it are still one show. */
async function loadLibraryShows(): Promise<LibraryShow[]> {
  const result = await query<{ tmdb_id: string; title: string; network: string | null }>(
    `SELECT DISTINCT ON (tmdb_id) tmdb_id, title, network
     FROM series
     WHERE tmdb_id ~ '^[0-9]+$'
     ORDER BY tmdb_id, created_at, id`
  )
  return result.rows.map((r) => ({ tmdbId: Number(r.tmdb_id), title: r.title, network: r.network }))
}

/**
 * Regular episodes per season, an episode held in both copies of a show counted once.
 *
 * An episode with no file is a placeholder a media server can list for what it lacks,
 * so it is not held. If no episode anywhere has a path, the server is not reporting
 * paths at all, and counting none would call the whole library missing.
 *
 * A double-length episode kept as one file is one row covering two numbers
 * (`episode_number_end`), so every number a row covers is counted, not the row.
 */
async function loadHeldEpisodes(): Promise<Map<number, Map<number, number>>> {
  const result = await query<{ tmdb_id: string; season_number: number; held: number }>(
    `SELECT s.tmdb_id, e.season_number, COUNT(DISTINCT covered.n)::int AS held
     FROM episodes e
     JOIN series s ON s.id = e.series_id
     CROSS JOIN LATERAL generate_series(
       e.episode_number,
       GREATEST(e.episode_number, COALESCE(e.episode_number_end, e.episode_number))
     ) AS covered(n)
     WHERE s.tmdb_id ~ '^[0-9]+$' AND e.season_number > 0
       AND (e.path IS NOT NULL OR NOT EXISTS (SELECT 1 FROM episodes WHERE path IS NOT NULL))
     GROUP BY s.tmdb_id, e.season_number`
  )
  const held = new Map<number, Map<number, number>>()
  for (const row of result.rows) {
    const id = Number(row.tmdb_id)
    let seasons = held.get(id)
    if (!seasons) {
      seasons = new Map()
      held.set(id, seasons)
    }
    seasons.set(row.season_number, row.held)
  }
  return held
}

// ---------------------------------------------------------------------------
// Scan job
// ---------------------------------------------------------------------------

export interface SeriesGapScanResult {
  runId: string | null
  cancelled: boolean
  showsScanned: number
  showsListed: number
  missingSeasons: number
  partialSeasons: number
}

export async function runSeriesGapAnalysis(options: { jobId?: string } = {}): Promise<SeriesGapScanResult> {
  const { jobId } = options
  const log = (message: string) => {
    logger.info(message)
    if (jobId) addLog(jobId, 'info', message)
  }

  await runs.clearLeftovers()

  // The row comes first, so a failure at any later step leaves a record for the page.
  const run = await queryOne<{ id: string }>(
    `INSERT INTO gap_analysis_series_runs DEFAULT VALUES RETURNING id`
  )
  if (!run) throw new Error('Failed to create the scan')
  const runId = run.id

  const counts = {
    scanned: 0,
    listed: 0,
    numbering: 0,
    notOnTmdb: 0,
    failed: 0,
    aired: 0,
    owned: 0,
    missing: 0,
    partial: 0,
  }
  const writeCounts = () =>
    query(
      `UPDATE gap_analysis_series_runs SET
         shows_scanned = $2, shows_listed = $3, shows_numbering_differs = $4,
         shows_not_on_tmdb = $5, lookups_failed = $6, aired_seasons = $7,
         owned_seasons = $8, missing_seasons = $9, partial_seasons = $10
       WHERE id = $1`,
      [
        runId,
        counts.scanned,
        counts.listed,
        counts.numbering,
        counts.notOnTmdb,
        counts.failed,
        counts.aired,
        counts.owned,
        counts.missing,
        counts.partial,
      ]
    )

  try {
    if (jobId) setJobStep(jobId, 0, 'Reading the library', 1)
    const [shows, heldByShow, prerequisites] = await Promise.all([
      loadLibraryShows(),
      loadHeldEpisodes(),
      getSeriesGapPrerequisites(),
    ])
    log(`${shows.length} shows with a TMDb id; ${prerequisites.showsWithoutTmdbId} without one`)
    await query(
      `UPDATE gap_analysis_series_runs SET shows_total = $2, shows_without_tmdb_id = $3 WHERE id = $1`,
      [runId, shows.length, prerequisites.showsWithoutTmdbId]
    )

    if (jobId) setJobStep(jobId, 1, `Comparing ${shows.length} shows with TMDb`, shows.length)
    const seerrConfigured = await isSeerrConfigured()
    const silence = tmdbSilenceGuard()
    const allowedUnread = unreadableAllowed(shows.length)

    for (let i = 0; i < shows.length; i += CHUNK_SIZE) {
      if (jobId && isJobCancelled(jobId)) {
        await runs.discard(runId)
        log('Cancelled; the previous results stay in place')
        return {
          runId: null,
          cancelled: true,
          showsScanned: counts.scanned,
          showsListed: counts.listed,
          missingSeasons: counts.missing,
          partialSeasons: counts.partial,
        }
      }

      const chunk = shows.slice(i, i + CHUNK_SIZE)
      const answers = await Promise.all(chunk.map((show) => tmdbLookup<TmdbShow>(`/tv/${show.tmdbId}`)))

      const compared: {
        show: LibraryShow
        data: TmdbShow
        seasons: ReturnType<typeof compareShowSeasons>['seasons']
        numberingDiffers: boolean
      }[] = []
      let answeredInBatch = 0

      answers.forEach((answer, index) => {
        const show = chunk[index]
        if (answer.status === 'failed') {
          counts.failed++
          return
        }
        answeredInBatch++
        if (answer.status === 'not_found') {
          counts.notOnTmdb++
          return
        }
        const { seasons, numberingDiffers } = compareShowSeasons({
          seasons: answer.data.seasons ?? [],
          lastEpisode: answer.data.last_episode_to_air,
          held: heldByShow.get(show.tmdbId) ?? new Map(),
        })
        if (numberingDiffers) {
          counts.numbering++
        } else {
          counts.aired += seasons.length
          counts.owned += seasons.filter((s) => s.holding === 'complete').length
          counts.missing += seasons.filter((s) => s.holding === 'missing').length
          counts.partial += seasons.filter((s) => s.holding === 'partial').length
        }
        if (numberingDiffers || seasons.some((s) => s.holding !== 'complete')) {
          compared.push({ show, data: answer.data, seasons, numberingDiffers })
        }
      })

      silence.afterBatch(answeredInBatch)
      // A show that went unread drops off the list, and nothing stored can stand in for it.
      if (counts.failed > allowedUnread) throw silence.tooLittleRead()

      // Seerr is asked only about shows with a gap to act on. A show it did not answer
      // for is treated as a gap and logged, as the movie scan treats a film.
      const toAsk = compared.filter((c) => !c.numberingDiffers).map((c) => c.show.tmdbId)
      const seerr = seerrConfigured && toAsk.length > 0 ? await batchGetSeasonStatuses(toAsk) : null
      const unanswered = seerr ? toAsk.filter((id) => !seerr.has(id)).length : 0
      if (unanswered > 0) log(`Seerr: ${unanswered} show(s) returned no status; treated as gaps`)

      for (const { show, data, seasons, numberingDiffers } of compared) {
        const statuses = seerr?.get(show.tmdbId)
        const stored: StoredSeason[] = seasons.map((s) => ({
          ...s,
          seerrStatus: statuses?.get(s.seasonNumber) ?? 'none',
        }))
        await query(
          `INSERT INTO gap_analysis_series_results
             (run_id, tmdb_id, title, poster_path, networks, numbering_differs, seasons)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (run_id, tmdb_id) DO NOTHING`,
          [
            runId,
            show.tmdbId,
            show.title,
            data.poster_path ?? null,
            showNetworks(data.networks, show.network),
            numberingDiffers,
            JSON.stringify(stored),
          ]
        )
        counts.listed++
      }

      counts.scanned += chunk.length
      await writeCounts()
      if (jobId) updateJobProgress(jobId, counts.scanned, shows.length, `${counts.scanned}/${shows.length}`)
    }

    silence.atEnd()

    if (jobId) setJobStep(jobId, 2, 'Finalizing snapshot', 1)
    await runs.finishAndReplace(runId)

    log(
      `Done: ${counts.scanned} shows, ${counts.missing} missing seasons, ${counts.partial} partly held, ` +
        `${counts.numbering} with different numbering, ${counts.notOnTmdb} not on TMDb, ${counts.failed} lookups failed`
    )
    return {
      runId,
      cancelled: false,
      showsScanned: counts.scanned,
      showsListed: counts.listed,
      missingSeasons: counts.missing,
      partialSeasons: counts.partial,
    }
  } catch (err) {
    await runs.fail(runId, err instanceof Error ? err.message : 'Unknown error')
    throw err
  }
}

// ---------------------------------------------------------------------------
// Reads (SQL only)
// ---------------------------------------------------------------------------

/** Requests in flight per show, read fresh so a season requested since the scan shows it. */
export async function getActiveSeriesRequests(tmdbIds: number[]): Promise<Map<number, ActiveSeriesRequest[]>> {
  const active = new Map<number, ActiveSeriesRequest[]>()
  if (tmdbIds.length === 0) return active
  const result = await query<{ tmdb_id: number; seasons: number[] | null }>(
    `SELECT tmdb_id, seasons FROM discovery_requests
     WHERE media_type = 'series' AND tmdb_id = ANY($1::int[]) AND status = ANY($2::text[])`,
    [tmdbIds, IN_FLIGHT_REQUEST_STATUSES]
  )
  for (const row of result.rows) {
    const list = active.get(row.tmdb_id)
    if (list) list.push({ seasons: row.seasons })
    else active.set(row.tmdb_id, [{ seasons: row.seasons }])
  }
  return active
}

export async function listSeriesGapShows(options: {
  runId: string
  page?: number
  pageSize?: number
}): Promise<{ shows: SeriesGapShow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(500, Math.max(1, options.pageSize ?? 100))

  const count = await queryOne<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM gap_analysis_series_results WHERE run_id = $1`,
    [options.runId]
  )

  const result = await query<{
    tmdb_id: number
    title: string
    poster_path: string | null
    networks: string[]
    numbering_differs: boolean
    seasons: StoredSeason[]
    library_id: string | null
  }>(
    // One library row per show; resolved here so a show removed since the scan has no dead link.
    `SELECT r.tmdb_id, r.title, r.poster_path, r.networks, r.numbering_differs, r.seasons, lib.id AS library_id
     FROM gap_analysis_series_results r
     LEFT JOIN LATERAL (
       SELECT s.id FROM series s
       WHERE s.tmdb_id = r.tmdb_id::text
       ORDER BY s.created_at ASC
       LIMIT 1
     ) lib ON true
     WHERE r.run_id = $1
     ORDER BY r.title ASC, r.tmdb_id ASC
     LIMIT $2 OFFSET $3`,
    [options.runId, pageSize, (page - 1) * pageSize]
  )

  const active = await getActiveSeriesRequests(result.rows.map((r) => r.tmdb_id))
  const shows = result.rows.map((row) =>
    decideSeriesGapShow(
      {
        tmdbId: row.tmdb_id,
        title: row.title,
        posterPath: row.poster_path,
        networks: row.networks,
        libraryId: row.library_id,
        numberingDiffers: row.numbering_differs,
        seasons: row.seasons,
      },
      active.get(row.tmdb_id) ?? []
    )
  )

  return { shows, total: count?.c ?? 0, page, pageSize }
}
