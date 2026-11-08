/**
 * Admin-only Gap Analysis API
 */

import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'
import {
  getLatestCompletedGapRun,
  getActiveRunningGapRun,
  getFailedGapRun,
  getGapCollectionSummaries,
  getGapCollectionParts,
  listGapResults,
  getSystemSetting,
  isSeerrConfigured,
  createSeerrRequest,
  createDiscoveryRequest,
  hasExistingRequest,
  withSeerrRequestLock,
  settleUnconfirmedRequestsFor,
  recordSeerrAnswer,
  resolveSeerrUserIdForProfile,
  getLatestCompletedSeriesGapRun,
  getActiveSeriesGapRun,
  getFailedSeriesGapRun,
  getSeriesGapPrerequisites,
  countEpisodesChangedSince,
  getActiveSeriesRequests,
  listSeriesGapShows,
  readRequestedSeasons,
  seasonsStillToRequest,
} from '@aperture/core'
import { requireAdmin, type SessionUser } from '../../plugins/auth.js'
import { query, queryOne } from '../../lib/db.js'
import { runJob } from '../jobs/executor.js'
import { activeJobs, claimJob } from '../jobs/state.js'

const BLOCKING_STATUSES = new Set(['pending', 'submitted', 'approved'])
const MOVIE_GAPS_JOB = 'refresh-library-gaps'
const SERIES_GAPS_JOB = 'refresh-series-gaps'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureSeerrUserIdForRequest(userId: string): Promise<number | null> {
  const row = await queryOne<{
    seerr_user_id: number | null
    email: string | null
    username: string
    display_name: string | null
    provider: 'emby' | 'jellyfin'
    provider_user_id: string
  }>(
    `SELECT seerr_user_id, email, username, display_name, provider, provider_user_id
     FROM users WHERE id = $1`,
    [userId]
  )
  if (!row) return null
  if (row.seerr_user_id != null) return row.seerr_user_id

  const resolved = await resolveSeerrUserIdForProfile({
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    provider: row.provider,
    providerUserId: row.provider_user_id,
  })
  if (resolved != null) {
    await query(`UPDATE users SET seerr_user_id = $1, updated_at = NOW() WHERE id = $2`, [
      resolved,
      userId,
    ])
  }
  return resolved
}

const gapAnalysisRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/admin/gap-analysis/latest
   * Returns the latest run metadata + per-collection summaries (pure SQL, fast).
   */
  fastify.get(
    '/api/admin/gap-analysis/latest',
    { preHandler: requireAdmin },
    async (_request, reply) => {
      const tmdbKey = await getSystemSetting('tmdb_api_key')
      const moviesWithCollection = await queryOne<{ c: string }>(
        `SELECT COUNT(*)::text as c FROM movies
         WHERE collection_id IS NOT NULL AND trim(collection_id) != ''`
      )
      const collectionMovieCount = parseInt(moviesWithCollection?.c ?? '0', 10)

      // The job slot is the truth about a scan: a `running` row with no job behind it
      // is from a process that died, and must not read as a scan in progress. Boot
      // closes such a row; this GET writes nothing, since read-only callers reach it.
      const scanning = activeJobs.has(MOVIE_GAPS_JOB)
      const activeRun = scanning ? await getActiveRunningGapRun() : null
      const latest = await getLatestCompletedGapRun()
      const failedRun = scanning ? null : await getFailedGapRun()

      // Summaries for whichever run the page is showing: the last finished one, kept up
      // until a new scan finishes, or a first scan as it goes. A run streams every
      // released part of a collection in one insert batch, so a running run's counts are
      // already whole per collection; withholding them left that live listing with gaps
      // and no totals to set them against.
      const displayRun = latest ?? activeRun
      const collectionSummaries = displayRun ? await getGapCollectionSummaries(displayRun.id) : []

      // A snapshot goes stale when the library moves under it, not after a
      // fixed number of days — so say how far it has moved. Null while a scan
      // is running or before one has finished, which is "not applicable", not 0.
      let moviesAddedSinceRun: number | null = null
      if (!scanning && latest?.completedAt) {
        const added = await queryOne<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM movies WHERE created_at > $1`,
          [latest.completedAt]
        )
        moviesAddedSinceRun = parseInt(added?.c ?? '0', 10)
      }

      return reply.send({
        prerequisites: {
          tmdbConfigured: !!(tmdbKey && tmdbKey.trim() !== ''),
          moviesWithCollectionCount: collectionMovieCount,
        },
        scanning,
        run: latest,
        activeRun,
        failedRun,
        collectionSummaries,
        moviesAddedSinceRun,
      })
    }
  )

  /**
   * GET /api/admin/gap-analysis/results
   * Paginated missing gap results (pure SQL, fast).
   */
  fastify.get<{
    Querystring: {
      runId?: string
      collectionId?: string
      search?: string
      page?: string
      pageSize?: string
      sortBy?: string
      sortDir?: string
    }
  }>('/api/admin/gap-analysis/results', { preHandler: requireAdmin }, async (request, reply) => {
    const user = request.user as SessionUser
    const latest = await getLatestCompletedGapRun()
    const runId = request.query.runId || latest?.id
    if (!runId) {
      return reply.status(404).send({ error: 'No gap analysis run found' })
    }

    const page = request.query.page ? parseInt(request.query.page, 10) : 1
    const pageSize = request.query.pageSize ? parseInt(request.query.pageSize, 10) : 50
    const collectionId =
      request.query.collectionId != null && request.query.collectionId !== ''
        ? parseInt(request.query.collectionId, 10)
        : undefined

    const rawSort = request.query.sortBy
    const sortBy =
      rawSort === 'title' || rawSort === 'release_date' || rawSort === 'collection_name'
        ? rawSort
        : undefined
    const rawDir = request.query.sortDir
    const sortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : undefined

    const result = await listGapResults({
      runId,
      userId: user.id,
      collectionId: Number.isFinite(collectionId as number) ? collectionId : undefined,
      search: request.query.search,
      sortBy,
      sortDir,
      page,
      pageSize,
    })

    return reply.send(result)
  })

  /**
   * GET /api/admin/gap-analysis/collection-parts?ids=1,2,3
   * All released parts for given collections with in_library + seerr_status (pure SQL, fast).
   */
  fastify.get(
    '/api/admin/gap-analysis/collection-parts',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const raw = (request.query as { ids?: string }).ids
      if (!raw || !String(raw).trim()) {
        return reply
          .status(400)
          .send({ error: 'Query parameter ids is required (comma-separated TMDb collection ids)' })
      }

      // The run the page is listing, as /latest decides it.
      const run =
        (await getLatestCompletedGapRun()) ??
        (activeJobs.has(MOVIE_GAPS_JOB) ? await getActiveRunningGapRun() : null)
      if (!run) {
        return reply.status(404).send({ error: 'No completed gap analysis run' })
      }

      const ids = String(raw)
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n))

      const map = await getGapCollectionParts(run.id, ids)
      const collections: Record<string, { collectionId: number; collectionName: string; collectionPosterPath: string | null; parts: unknown[] }> = {}
      for (const [id, payload] of map) {
        collections[String(id)] = payload
      }
      return reply.send({ collections })
    }
  )

  /**
   * POST /api/admin/gap-analysis/refresh
   */
  fastify.post('/api/admin/gap-analysis/refresh', { preHandler: requireAdmin }, async (_request, reply) => {
    const name = MOVIE_GAPS_JOB
    const jobId = randomUUID()
    const claim = claimJob(name, jobId)
    if (!claim.ok) {
      return reply.status(409).send({
        error: claim.cancelling
          ? 'Gap analysis was cancelled and is still winding down'
          : 'Gap analysis is already running',
        jobId: claim.jobId,
      })
    }

    runJob(name, jobId).catch((err) => {
      fastify.log.error({ err, jobId }, 'refresh-library-gaps failed')
    })

    return reply.send({
      message: 'Library gap analysis started',
      jobId,
      jobName: name,
      status: 'running',
    })
  })

  /**
   * GET /api/admin/gap-analysis/series/latest
   * TV: whether a scan is running, the snapshot to show, and how far the library has moved since.
   */
  fastify.get(
    '/api/admin/gap-analysis/series/latest',
    { preHandler: requireAdmin },
    async (_request, reply) => {
      // The job slot is the truth about a scan: a `running` row with no job behind it
      // is from a process that died, and must not lock the Run button. Boot closes it.
      const scanning = activeJobs.has(SERIES_GAPS_JOB)

      const [tmdbKey, library, run, activeRun, failedRun] = await Promise.all([
        getSystemSetting('tmdb_api_key'),
        getSeriesGapPrerequisites(),
        getLatestCompletedSeriesGapRun(),
        scanning ? getActiveSeriesGapRun() : null,
        scanning ? null : getFailedSeriesGapRun(),
      ])

      return reply.send({
        prerequisites: {
          tmdbConfigured: !!tmdbKey?.trim(),
          showsWithTmdbId: library.showsWithTmdbId,
        },
        scanning,
        run,
        activeRun,
        failedRun,
        // Null while a scan runs or before one has finished: "not applicable", not 0.
        episodesChangedSinceRun:
          !scanning && run?.completedAt ? await countEpisodesChangedSince(run.completedAt) : null,
      })
    }
  )

  /**
   * GET /api/admin/gap-analysis/series/results
   * Shows with a season gap, paged by show, each season's standing decided (pure SQL).
   */
  fastify.get<{ Querystring: { runId?: string; page?: string; pageSize?: string } }>(
    '/api/admin/gap-analysis/series/results',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const runId = request.query.runId || (await getLatestCompletedSeriesGapRun())?.id
      if (!runId) return reply.status(404).send({ error: 'No TV gap analysis run found' })
      const page = request.query.page ? parseInt(request.query.page, 10) : 1
      const pageSize = request.query.pageSize ? parseInt(request.query.pageSize, 10) : 100
      return reply.send(
        await listSeriesGapShows({
          runId,
          page: Number.isFinite(page) ? page : 1,
          pageSize: Number.isFinite(pageSize) ? pageSize : 100,
        })
      )
    }
  )

  /**
   * POST /api/admin/gap-analysis/series/refresh
   */
  fastify.post(
    '/api/admin/gap-analysis/series/refresh',
    { preHandler: requireAdmin },
    async (_request, reply) => {
      const jobId = randomUUID()
      const claim = claimJob(SERIES_GAPS_JOB, jobId)
      if (!claim.ok) {
        return reply.status(409).send({
          error: claim.cancelling
            ? 'TV gap analysis was cancelled and is still winding down'
            : 'TV gap analysis is already running',
          jobId: claim.jobId,
        })
      }

      runJob(SERIES_GAPS_JOB, jobId).catch((err) => {
        fastify.log.error({ err, jobId }, 'refresh-series-gaps failed')
      })

      return reply.send({ message: 'TV gap analysis started', jobId, jobName: SERIES_GAPS_JOB, status: 'running' })
    }
  )

  /**
   * POST /api/admin/gap-analysis/request
   *
   * A series item may name `seasons`, and then one show can be requested more than
   * once: what blocks it is an in-flight request for those seasons, not any request
   * for the show. Without `seasons` it means the whole show, as it always did.
   */
  fastify.post<{
    Body: {
      items: { tmdbId: number; mediaType: 'movie' | 'series'; title: string; seasons?: number[] }[]
      seerrOptions?: {
        rootFolder?: string
        profileId?: number
        serverId?: number
        is4k?: boolean
        languageProfileId?: number
      }
    }
  }>('/api/admin/gap-analysis/request', { preHandler: requireAdmin }, async (request, reply) => {
    const user = request.user as SessionUser
    const { items, seerrOptions } = request.body || { items: [] }

    if (!Array.isArray(items) || items.length === 0) {
      return reply.status(400).send({ error: 'items array required' })
    }
    if (items.length > 200) {
      return reply.status(400).send({ error: 'Maximum 200 items per request' })
    }

    if (!(await isSeerrConfigured())) {
      return reply.status(503).send({ error: 'Seerr is not configured' })
    }

    const requireMapping = (await getSystemSetting('seerr_require_user_mapping')) === 'true'
    const seerrUserId = await ensureSeerrUserIdForRequest(user.id)
    if (requireMapping && seerrUserId == null) {
      return reply.status(422).send({
        error: 'Seerr account not linked',
        message:
          'Your Aperture account could not be matched to a Seerr user. Ask an admin to link Seerr.',
      })
    }

    let submitted = 0
    let skipped = 0
    let failed = 0
    const errors: { tmdbId: number; title: string; message: string }[] = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item || typeof item.tmdbId !== 'number' || !item.title) {
        failed++
        errors.push({ tmdbId: item?.tmdbId ?? 0, title: item?.title ?? '', message: 'Invalid item' })
        continue
      }
      if (item.mediaType !== 'movie' && item.mediaType !== 'series') {
        failed++
        errors.push({ tmdbId: item.tmdbId, title: item.title, message: 'Invalid mediaType' })
        continue
      }

      let namedSeasons: number[] | undefined
      if (item.seasons !== undefined) {
        const named = item.mediaType === 'series' ? readRequestedSeasons(item.seasons) : null
        if (!named) {
          failed++
          errors.push({ tmdbId: item.tmdbId, title: item.title, message: 'Invalid seasons' })
          continue
        }
        namedSeasons = named
      }

      // Checked and sent under the title's request lock, like every request
      // (core seerr/submission.ts), with any earlier unanswered request of this
      // admin's for it decided first.
      type ItemOutcome =
        | { kind: 'skipped' }
        | { kind: 'inLibrary' }
        | { kind: 'submitted' }
        | { kind: 'failed'; message: string }
      const decided = await withSeerrRequestLock(item.mediaType, item.tmdbId, async (): Promise<ItemOutcome> => {
        const earlier = await settleUnconfirmedRequestsFor(user.id, item.mediaType, item.tmdbId)
        if (earlier.stillWaiting) {
          return { kind: 'failed', message: 'An earlier request is still waiting for Seerr to confirm it' }
        }

        let seasons: number[] | undefined
        if (namedSeasons) {
          const active = (await getActiveSeriesRequests([item.tmdbId])).get(item.tmdbId) ?? []
          seasons = seasonsStillToRequest(namedSeasons, active)
          if (seasons.length === 0) return { kind: 'skipped' }
        } else {
          const existing = await hasExistingRequest(user.id, item.tmdbId, item.mediaType)
          if (existing && BLOCKING_STATUSES.has(existing.status)) return { kind: 'skipped' }
          // A film that reached the library since the scan is no gap any more.
          if (item.mediaType === 'movie') {
            const held = await queryOne<{ one: number }>(
              `SELECT 1 AS one FROM movies WHERE tmdb_id = $1 LIMIT 1`,
              [String(item.tmdbId)]
            )
            if (held) return { kind: 'inLibrary' }
          }
        }

        const sentAt = new Date()
        const apertureRequestId = await createDiscoveryRequest(
          user.id,
          item.mediaType,
          item.tmdbId,
          item.title,
          undefined,
          'gap_analysis',
          seasons,
          seerrUserId
        )

        const seerrMediaType = item.mediaType === 'movie' ? 'movie' : 'tv'
        const result = await createSeerrRequest(item.tmdbId, seerrMediaType, {
          ...(seasons ? { seasons } : {}),
          ...(seerrUserId != null ? { userId: seerrUserId } : {}),
          ...(seerrOptions?.rootFolder !== undefined ? { rootFolder: seerrOptions.rootFolder } : {}),
          ...(seerrOptions?.profileId !== undefined ? { profileId: seerrOptions.profileId } : {}),
          ...(seerrOptions?.serverId !== undefined ? { serverId: seerrOptions.serverId } : {}),
          ...(seerrOptions?.is4k !== undefined ? { is4k: seerrOptions.is4k } : {}),
          ...(seerrOptions?.languageProfileId !== undefined
            ? { languageProfileId: seerrOptions.languageProfileId }
            : {}),
        })

        const outcome = await recordSeerrAnswer(apertureRequestId, result, {
          mediaType: item.mediaType,
          tmdbId: item.tmdbId,
          seasons: seasons ?? null,
          sentAt,
          // Sent with Seerr's body userId, so that is who Seerr credits.
          requestedAs: seerrUserId ?? null,
        })
        if (outcome.kind === 'submitted') return { kind: 'submitted' }
        return { kind: 'failed', message: outcome.message }
      }).catch((err: unknown): { busy: false; value: ItemOutcome } => ({
        busy: false,
        value: { kind: 'failed', message: err instanceof Error ? err.message : 'Unknown error' },
      }))

      const outcome: ItemOutcome = decided.busy
        ? { kind: 'failed', message: 'A request for this title is being sent to Seerr right now' }
        : decided.value
      if (outcome.kind === 'skipped') {
        skipped++
        continue
      }
      if (outcome.kind === 'inLibrary') {
        // Not requested, and said so: the page marks every item missing from
        // `errors` as requested.
        skipped++
        errors.push({ tmdbId: item.tmdbId, title: item.title, message: 'Already in the library since the scan' })
        continue
      }
      if (outcome.kind === 'submitted') {
        submitted++
      } else {
        failed++
        errors.push({ tmdbId: item.tmdbId, title: item.title, message: outcome.message })
      }

      if (i < items.length - 1) {
        await sleep(200)
      }
    }

    return reply.send({ submitted, skipped, failed, errors })
  })
}

export default gapAnalysisRoutes
