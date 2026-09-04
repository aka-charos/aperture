/**
 * Discovery Pipeline
 *
 * Main orchestration for generating discovery suggestions.
 *
 * There is ONE per-user implementation (runDiscoveryForUser) and it always
 * takes its global candidates from the shared pool. That matters: this file
 * previously held two near-identical ~200-line functions -- one that read the
 * pool and one that re-fetched every global source per user via the deprecated
 * fetchAllCandidates -- whose last four steps were copy-paste. The scheduled
 * job used the good one and the user-facing refresh button used the other, so
 * the two entry points could drift in behaviour and cost while both typechecked.
 *
 * Shape of a run:
 *   Phase 1 (once per media type): prune stale pool rows, fetch global sources
 *           (TMDb Discover, Trakt Trending/Popular), upsert into the pool.
 *   Phase 2 (per user, per media type): fetch personalized sources, merge with
 *           the pool, filter, score, enrich the top slice, store.
 */

import { createChildLogger } from '../lib/logger.js'
import { query, queryOne } from '../lib/db.js'
import {
  enrichFullData,
  fetchGlobalCandidates,
  fetchPersonalizedCandidates,
  mergeWithPool,
  enrichBasicData,
} from './sources.js'
import { filterCandidates } from './filter.js'
import { clearOrphanedCandidateEmbeddings, clearDiscoveryRunCaches } from './embeddings.js'
import { scoreCandidates } from './scorer.js'
import {
  createDiscoveryRun,
  updateDiscoveryRunStats,
  finalizeDiscoveryRun,
  storeDiscoveryCandidates,
  upsertPoolCandidates,
  getPoolCandidates,
  poolCandidateToRaw,
  clearOldPoolEntries,
  updatePoolEnrichmentBatch,
} from './storage.js'
import {
  addLog,
  updateJobProgress,
  isJobCancelled,
} from '../jobs/progress.js'
import type {
  MediaType,
  DiscoveryConfig,
  DiscoveryPipelineResult,
  DiscoveryUser,
  ScoredCandidate,
  RawCandidate,
} from './types.js'

const logger = createChildLogger('discover:pipeline')

/** Returns true when the caller wants the run to stop. */
type ShouldCancel = () => boolean

const MEDIA_TYPES: MediaType[] = ['movie', 'series']

/** An empty result, for the several early exits that legitimately produce none. */
function emptyResult(runId: string, fetched: number, durationMs: number): DiscoveryPipelineResult {
  return {
    runId,
    candidates: [],
    candidatesFetched: fetched,
    candidatesFiltered: 0,
    candidatesScored: 0,
    candidatesStored: 0,
    durationMs,
  }
}

/**
 * Read the pool for a media type, seeding it from the global sources if it is
 * empty.
 *
 * The seed is what lets the user-facing refresh work on an instance where the
 * scheduled job has never run, without that path reverting to fetching every
 * global source for one user and throwing the results away. Anything it fetches
 * lands in the pool, so the next caller -- any user -- reuses it.
 */
async function loadPoolCandidates(
  mediaType: MediaType,
  config: DiscoveryConfig
): Promise<RawCandidate[]> {
  const read = () =>
    getPoolCandidates(mediaType, {
      limit: config.maxPoolCandidates,
      maxAgeDays: config.poolMaxAgeDays,
    })

  let pool = await read()
  if (pool.length > 0) return pool.map(poolCandidateToRaw)

  logger.info({ mediaType }, 'Pool is empty, seeding from global sources')
  const globalResult = await fetchGlobalCandidates(mediaType, config)
  if (globalResult.candidates.length > 0) {
    const enriched = await enrichBasicData(globalResult.candidates, mediaType)
    await upsertPoolCandidates(mediaType, enriched)
  }

  pool = await read()
  return pool.map(poolCandidateToRaw)
}

/**
 * The one per-user implementation. Takes pool candidates already in hand so the
 * all-users job can read them once and share them across every user.
 */
async function runDiscoveryForUser(
  user: DiscoveryUser,
  mediaType: MediaType,
  config: DiscoveryConfig,
  poolCandidates: RawCandidate[],
  runType: 'scheduled' | 'manual',
  shouldCancel?: ShouldCancel,
  /** Present only on the all-users job, which is the surface with a log pane. */
  jobId?: string
): Promise<DiscoveryPipelineResult> {
  const startTime = Date.now()
  const cancelled = () => shouldCancel?.() === true

  logger.info({ userId: user.id, username: user.username, mediaType }, 'Starting discovery generation')

  const runId = await createDiscoveryRun(user.id, mediaType, runType)

  try {
    // Step 1: personalized sources (TMDb recommendations/similar, Trakt recs)
    const personalizedResult = await fetchPersonalizedCandidates(user.id, mediaType, config)

    // Step 2: merge with the pool (personalized takes precedence by tmdbId)
    const mergedCandidates = mergeWithPool(personalizedResult.candidates, poolCandidates)

    await updateDiscoveryRunStats(runId, { candidatesFetched: mergedCandidates.length })

    logger.info({
      userId: user.id,
      personalized: personalizedResult.totalFetched,
      pool: poolCandidates.length,
      merged: mergedCandidates.length,
    }, 'Merged candidates')

    if (mergedCandidates.length === 0) {
      logger.warn({ userId: user.id, mediaType }, 'No candidates available')
      const durationMs = Date.now() - startTime
      await finalizeDiscoveryRun(runId, 'completed', durationMs)
      return emptyResult(runId, 0, durationMs)
    }

    // Step 3: drop anything already in the library, watched, or requested
    const filteredCandidates = await filterCandidates(user.id, mediaType, mergedCandidates)

    await updateDiscoveryRunStats(runId, { candidatesFiltered: filteredCandidates.length })

    if (filteredCandidates.length === 0) {
      logger.warn({ userId: user.id, mediaType }, 'All candidates filtered out')
      const durationMs = Date.now() - startTime
      await finalizeDiscoveryRun(runId, 'completed', durationMs)
      return emptyResult(runId, mergedCandidates.length, durationMs)
    }

    // Cheap exit before the two expensive stages.
    if (cancelled()) {
      const durationMs = Date.now() - startTime
      logger.info({ userId: user.id, mediaType }, 'Cancelled before scoring')
      await finalizeDiscoveryRun(runId, 'completed', durationMs)
      return emptyResult(runId, mergedCandidates.length, durationMs)
    }

    // Step 4: score and rank
    const { candidates: allScoredCandidates, taste } = await scoreCandidates(
      user.id,
      mediaType,
      filteredCandidates,
      config
    )

    const maxTotal = config.maxTotalCandidates || 200
    const candidatesToStore = allScoredCandidates.slice(0, maxTotal)

    await updateDiscoveryRunStats(runId, { candidatesScored: candidatesToStore.length })

    // Report the taste term's RAW spread to the job console.
    //
    // This is the one number that says whether the taste half of the scorer is
    // actually running. It was the constant 0.5 for every candidate on every
    // run for as long as the feature existed, and nothing said so -- the run
    // looked healthy, the log looked healthy, and popularity silently decided
    // the order.
    //
    // The first version of this line read `candidatesToStore[].similarityScore`,
    // which is the value AFTER min-max normalisation across the pool -- so it
    // printed `0.00–1.00` on every run where any two candidates differed, and
    // could distinguish only "completely flat" from "not flat". The band that
    // started the whole investigation was 0.037 wide and would have rendered
    // identically. Raw figures are the diagnostic; they come from the scorer
    // because the normalisation destroys them.
    //
    // Emitted with addLog rather than the logger because the container log is
    // not where an operator looks after a deploy.
    if (jobId && candidatesToStore.length > 0) {
      const { compared, candidateCount, rawMin, rawMax } = taste
      const spread = rawMin != null && rawMax != null ? rawMax - rawMin : 0

      if (compared === 0) {
        addLog(
          jobId,
          'warn',
          `⚠️ ${user.username}: no ${mediaType} candidate could be compared against the taste profile — the term is contributing nothing. Most often a taste profile built under a different embedding model: run rebuild-taste-profiles.`
        )
      } else if (spread <= 0) {
        addLog(
          jobId,
          'warn',
          `⚠️ ${user.username}: taste match is flat at ${(rawMin ?? 0).toFixed(3)} across ${compared} ${mediaType}s — the taste term is not ranking anything.`
        )
      } else {
        // `compared` beside the count is the tell that separates "could not
        // compare" from "compared and disagreed usefully"; both look like a
        // healthy run without it.
        const partial = compared < candidateCount ? `, ${compared}/${candidateCount} comparable` : ''
        addLog(
          jobId,
          spread < 0.05 ? 'warn' : 'info',
          `🎯 ${user.username}: taste match ${rawMin!.toFixed(3)}–${rawMax!.toFixed(3)} (spread ${spread.toFixed(3)}) across ${candidatesToStore.length} ${mediaType}s${partial}`
        )
      }
    }

    // Step 5: lazy enrichment -- only the top slice gets cast/crew/runtime.
    // Anything the pool already enriched is skipped inside enrichFullData.
    const maxEnriched = config.maxEnrichedCandidates || 75
    const candidatesToEnrich = candidatesToStore.slice(0, maxEnriched)
    const candidatesToSkipEnrichment = candidatesToStore.slice(maxEnriched)

    logger.info({
      userId: user.id,
      toEnrich: candidatesToEnrich.length,
      toSkip: candidatesToSkipEnrichment.length,
    }, 'Enriching top candidates with full metadata...')

    const enrichedRawCandidates = await enrichFullData(candidatesToEnrich, mediaType, shouldCancel)
    const enrichedMap = new Map(enrichedRawCandidates.map(c => [c.tmdbId, c]))

    // Cache what we just paid for onto the shared pool rows, so the next user's
    // run skips these lookups entirely. UPDATE-only, so personalized-source
    // candidates with no pool row are silently no-ops.
    await updatePoolEnrichmentBatch(mediaType, enrichedRawCandidates)

    const finalCandidates: ScoredCandidate[] = [
      ...candidatesToEnrich.map(scored => {
        const enriched = enrichedMap.get(scored.tmdbId)
        return {
          ...scored,
          castMembers: enriched?.castMembers ?? scored.castMembers,
          directors: enriched?.directors ?? scored.directors,
          runtimeMinutes: enriched?.runtimeMinutes ?? scored.runtimeMinutes,
          tagline: enriched?.tagline ?? scored.tagline,
          imdbId: enriched?.imdbId ?? scored.imdbId,
          posterPath: enriched?.posterPath ?? scored.posterPath,
          backdropPath: enriched?.backdropPath ?? scored.backdropPath,
          overview: enriched?.overview ?? scored.overview,
          originalLanguage: enriched?.originalLanguage ?? scored.originalLanguage,
          voteAverage: enriched?.voteAverage || scored.voteAverage,
          voteCount: enriched?.voteCount || scored.voteCount,
          // Not blindly true: enrichFullData can return a candidate untouched
          // when it was cancelled mid-way or the lookup failed, and claiming
          // otherwise would let the pool cache a blank card.
          isEnriched: (enriched?.castMembers?.length ?? 0) > 0,
        }
      }),
      ...candidatesToSkipEnrichment.map(c => ({ ...c, isEnriched: false })),
    ]

    // Both halves are already score-ordered, so the concatenation is too. Kept
    // as a guard rather than a correction.
    finalCandidates.sort((a, b) => b.finalScore - a.finalScore)

    // Step 6: store. A cancelled run still stores what it has already paid for
    // -- the rows are complete, some just carry less metadata.
    const storedCount = await storeDiscoveryCandidates(runId, user.id, finalCandidates, mediaType)

    await updateDiscoveryRunStats(runId, { candidatesStored: storedCount })

    const durationMs = Date.now() - startTime
    await finalizeDiscoveryRun(runId, 'completed', durationMs)

    logger.info({
      userId: user.id,
      username: user.username,
      mediaType,
      candidatesFetched: mergedCandidates.length,
      candidatesFiltered: filteredCandidates.length,
      candidatesScored: candidatesToStore.length,
      candidatesEnriched: candidatesToEnrich.length,
      candidatesStored: storedCount,
      cancelled: cancelled(),
      durationMs,
    }, 'Discovery generation complete')

    return {
      runId,
      candidates: finalCandidates,
      candidatesFetched: mergedCandidates.length,
      candidatesFiltered: filteredCandidates.length,
      candidatesScored: candidatesToStore.length,
      candidatesStored: storedCount,
      durationMs,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    const durationMs = Date.now() - startTime

    logger.error({ userId: user.id, err }, 'Discovery generation failed')
    await finalizeDiscoveryRun(runId, 'failed', durationMs, error)

    throw err
  }
}

/**
 * Generate discovery suggestions for a single user, reading the pool itself.
 *
 * For one user this is the right entry point. The all-users job calls the
 * shared implementation directly so it can read the pool once.
 */
export async function generateDiscoveryForUser(
  user: DiscoveryUser,
  mediaType: MediaType,
  config: DiscoveryConfig,
  runType: 'scheduled' | 'manual' = 'scheduled'
): Promise<DiscoveryPipelineResult> {
  clearDiscoveryRunCaches()
  const poolCandidates = await loadPoolCandidates(mediaType, config)
  return runDiscoveryForUser(user, mediaType, config, poolCandidates, runType)
}

/**
 * Get all users who have discovery enabled
 */
export async function getDiscoveryEnabledUsers(): Promise<DiscoveryUser[]> {
  const result = await query<{
    id: string
    username: string
    provider_user_id: string
    max_parental_rating: number | null
    discover_enabled: boolean
    discover_request_enabled: boolean
    trakt_access_token: string | null
  }>(
    // `provider_disabled` belongs here, and discovery was the only per-user
    // work loop in the codebase without it. Every other one gates on it -- both
    // recommender pipelines, both STRM writers, both watch-history syncs,
    // twinAffinity and rebuildAllTasteProfiles -- and strm/cleanup.ts treats it
    // as grounds to DELETE a user's generated output. So discovery was building
    // suggestions, spending TMDb and embedding calls, and holding Seerr request
    // rights for viewers the media server no longer has.
    //
    // The column is synced from the server's own Policy.IsDisabled by
    // users/sync.ts, so it is the media server's answer rather than ours.
    `SELECT id, username, provider_user_id, max_parental_rating,
            discover_enabled, discover_request_enabled, trakt_access_token
     FROM users
     WHERE is_enabled = true
       AND discover_enabled = true
       AND provider_disabled = false`
  )

  return result.rows.map(row => ({
    id: row.id,
    username: row.username,
    providerUserId: row.provider_user_id,
    maxParentalRating: row.max_parental_rating,
    discoverEnabled: row.discover_enabled,
    discoverRequestEnabled: row.discover_request_enabled,
    traktAccessToken: row.trakt_access_token,
  }))
}

/**
 * Generate discovery suggestions for all enabled users.
 *
 * Cancellable: the work polls isJobCancelled between media types, between
 * users, and between enrichment batches inside each user. Cancellation in this
 * codebase is cooperative -- cancelJob only sets a status -- so without these
 * checks Stop had no effect on what is the longest-running job in the system by
 * external call count, and the job appeared wedged because its slot is held
 * until the work actually exits.
 */
export async function generateDiscoveryForAllUsers(
  config: DiscoveryConfig,
  jobId?: string
): Promise<{
  success: number
  failed: number
  cancelled: boolean
  jobId: string
}> {
  const actualJobId = jobId || crypto.randomUUID()
  // With no job id there is no progress record, so isJobCancelled would always
  // read false -- don't hand the work a predicate that cannot fire.
  const shouldCancel: ShouldCancel | undefined = jobId
    ? () => isJobCancelled(actualJobId)
    : undefined
  const cancelled = () => shouldCancel?.() === true

  // The library mean and the centring readiness do not vary by viewer, and
  // nothing inside a discovery run writes an embedding or re-centres a column.
  // Cleared here so their lifetime is exactly this run.
  clearDiscoveryRunCaches()

  const users = await getDiscoveryEnabledUsers()

  if (users.length === 0) {
    logger.info('No users with discovery enabled')
    return { success: 0, failed: 0, cancelled: false, jobId: actualJobId }
  }

  // Total items: 2 global phases + (users * 2 media types)
  const totalItems = 2 + (users.length * 2)
  let processedItems = 0

  logger.info({ userCount: users.length }, 'Starting discovery generation for all users')
  addLog(actualJobId, 'info', `👥 Found ${users.length} user(s) with discovery enabled`)

  let success = 0
  let failed = 0

  // =========================================================================
  // Phase 1: prune, then fetch global candidates into the shared pool
  // =========================================================================

  for (const mediaType of MEDIA_TYPES) {
    if (cancelled()) break

    addLog(actualJobId, 'info', `🌍 Fetching global ${mediaType} candidates for shared pool...`)

    try {
      // Prune first, so the pool cannot grow without bound. Nothing else in the
      // system deletes from it, and every read merges it into a user's
      // candidate list -- so an unpruned pool makes each run slower than the
      // last and drags in titles nothing has seen for months.
      const pruned = await clearOldPoolEntries(mediaType, config.poolMaxAgeDays)
      // The candidate-vector cache is pruned on the same schedule and against
      // the same window, so it cannot become the unbounded thing the pool was.
      // Runs after the pool delete, so "no longer in the pool" is already true
      // for anything that just aged out.
      const embeddingsPruned = await clearOrphanedCandidateEmbeddings(
        mediaType,
        config.poolMaxAgeDays
      )
      if (embeddingsPruned > 0) {
        addLog(
          actualJobId,
          'info',
          `🧹 Dropped ${embeddingsPruned} cached ${mediaType} candidate vector(s) for titles no longer offered`
        )
      }
      if (pruned > 0) {
        addLog(
          actualJobId,
          'info',
          `🧹 Pruned ${pruned} ${mediaType} pool entr${pruned === 1 ? 'y' : 'ies'} not seen in ${config.poolMaxAgeDays} days`
        )
      }

      const globalResult = await fetchGlobalCandidates(mediaType, config)

      // Basic enrich Trakt candidates that lack poster/language/votes
      const enrichedGlobal = await enrichBasicData(globalResult.candidates, mediaType)

      const poolResult = await upsertPoolCandidates(mediaType, enrichedGlobal)

      addLog(
        actualJobId,
        'info',
        `✅ Pool: ${poolResult.inserted} new, ${poolResult.updated} updated ${mediaType}s`
      )

      logger.info({
        mediaType,
        fetched: globalResult.totalFetched,
        unique: globalResult.uniqueCount,
        poolInserted: poolResult.inserted,
        poolUpdated: poolResult.updated,
        poolPruned: pruned,
      }, 'Global candidates added to pool')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      logger.error({ mediaType, err }, 'Failed to fetch global candidates')
      addLog(actualJobId, 'error', `❌ Failed to fetch global ${mediaType} candidates: ${errorMsg}`)
      // Continue with other media type
    }

    processedItems++
    updateJobProgress(actualJobId, processedItems, totalItems, `Pool: ${mediaType}`)
  }

  if (cancelled()) {
    addLog(actualJobId, 'warn', '🛑 Cancelled before processing users')
    logger.info({ jobId: actualJobId }, 'Discovery generation cancelled')
    return { success, failed, cancelled: true, jobId: actualJobId }
  }

  // =========================================================================
  // Phase 2: process each user against the shared pool
  // =========================================================================

  addLog(actualJobId, 'info', `🔄 Processing ${users.length} user(s)...`)

  const poolByMediaType = new Map<MediaType, RawCandidate[]>()
  for (const mediaType of MEDIA_TYPES) {
    poolByMediaType.set(
      mediaType,
      (await getPoolCandidates(mediaType, {
        limit: config.maxPoolCandidates,
        maxAgeDays: config.poolMaxAgeDays,
      })).map(poolCandidateToRaw)
    )
  }

  addLog(
    actualJobId,
    'info',
    `📦 Pool: ${poolByMediaType.get('movie')?.length ?? 0} movies, ${poolByMediaType.get('series')?.length ?? 0} series`
  )

  let wasCancelled = false

  for (const user of users) {
    if (cancelled()) {
      wasCancelled = true
      break
    }

    for (const mediaType of MEDIA_TYPES) {
      if (cancelled()) {
        wasCancelled = true
        break
      }

      const poolCandidates = poolByMediaType.get(mediaType) ?? []

      try {
        addLog(actualJobId, 'info', `🎬 ${user.username}: ${mediaType}...`)

        await runDiscoveryForUser(user, mediaType, config, poolCandidates, 'scheduled', shouldCancel, actualJobId)

        success++
        addLog(actualJobId, 'info', `✅ ${user.username}: ${mediaType} complete`)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        logger.error({ userId: user.id, username: user.username, mediaType, err }, 'Failed to generate discovery')
        addLog(actualJobId, 'error', `❌ ${user.username}: ${mediaType} failed: ${errorMsg}`)
        failed++
      }

      processedItems++
      updateJobProgress(actualJobId, processedItems, totalItems, `${user.username}: ${mediaType}`)
    }
  }

  if (wasCancelled || cancelled()) {
    addLog(actualJobId, 'warn', `🛑 Cancelled after ${success} successful, ${failed} failed`)
    logger.info({ success, failed, jobId: actualJobId }, 'Discovery generation cancelled')
    return { success, failed, cancelled: true, jobId: actualJobId }
  }

  logger.info({ success, failed, jobId: actualJobId }, 'Discovery generation for all users complete')
  addLog(
    actualJobId,
    success > 0 ? 'info' : 'warn',
    `🏁 Complete: ${success} successful, ${failed} failed`
  )

  return { success, failed, cancelled: false, jobId: actualJobId }
}

/**
 * Regenerate discovery for a single user (user-initiated).
 *
 * Goes through the pool like every other path. It used to call the deprecated
 * all-in-one fetch, which re-requested every global source for this one user
 * and discarded the results afterwards.
 */
export async function regenerateUserDiscovery(
  userId: string,
  mediaType: MediaType
): Promise<DiscoveryPipelineResult> {
  const user = await queryOne<{
    id: string
    username: string
    provider_user_id: string
    max_parental_rating: number | null
    discover_enabled: boolean
    discover_request_enabled: boolean
    trakt_access_token: string | null
    provider_disabled: boolean
  }>(
    `SELECT id, username, provider_user_id, max_parental_rating,
            discover_enabled, discover_request_enabled, trakt_access_token,
            provider_disabled
     FROM users WHERE id = $1`,
    [userId]
  )

  if (!user) {
    throw new Error('User not found')
  }

  if (!user.discover_enabled) {
    throw new Error('Discovery not enabled for user')
  }

  // Checked here as well as in the job's user list, because the auth plugin
  // gates on is_enabled ALONE -- it never reads provider_disabled -- so a
  // viewer the media server has dropped can still hold a valid session and
  // press Refresh. Guarding only the scheduled path would leave the manual one
  // as the way around it.
  if (user.provider_disabled) {
    throw new Error('Discovery is unavailable: this account is disabled on the media server')
  }

  // The stored configuration, not the shipped defaults — the scheduled job and
  // this path must agree on how much to fetch and how hard to filter, or the
  // Refresh button quietly produces a different list from the nightly run.
  const { getDiscoveryConfig } = await import('./config.js')
  const config = await getDiscoveryConfig()

  return generateDiscoveryForUser(
    {
      id: user.id,
      username: user.username,
      providerUserId: user.provider_user_id,
      maxParentalRating: user.max_parental_rating,
      discoverEnabled: user.discover_enabled,
      discoverRequestEnabled: user.discover_request_enabled,
      traktAccessToken: user.trakt_access_token,
    },
    mediaType,
    config,
    'manual'
  )
}
