/**
 * Job Executor
 * Central job execution logic
 */

import {
  syncMovies,
  generateMissingEmbeddings,
  syncWatchHistoryForAllUsers,
  generateRecommendationsForAllUsers,
  clearAndRebuildAllRecommendations,
  processStrmForAllUsers,
  syncSeries,
  generateMissingSeriesEmbeddings,
  syncSeriesWatchHistoryForAllUsers,
  generateSeriesRecommendationsForAllUsers,
  clearAndRebuildAllSeriesRecommendations,
  processSeriesStrmForAllUsers,
  refreshTopPicks,
  enrichMetadata,
  enrichStudioLogos,
  enrichMDBListMetadata,
  processWatchingFavoritesForAllUsers,
  createBackup,
  refreshPricingCache,
  getPricingCacheStatus,
  cleanupExpiredAuthState,
  generateDiscoveryForAllUsers,
  DEFAULT_DISCOVERY_CONFIG,
  createJobProgress,
  setJobStep,
  addLog,
  completeJob,
  failJob,
  isJobCancelled,
  updateJobProgress,
  generateTitleAnalyses,
  refreshRatings,
  RATING_SOURCE_IDS,
  syncUsersFromMediaServer,
  syncLldapEmails,
  createChildLogger,
  runLibraryGapAnalysis,
  rebuildAllTasteProfiles,
  refreshCenteredEmbeddings,
  getEmbeddingSetsReport,
  runEvaluation,
  getEvaluationSeedTitles,
  type EmbeddingSetRef,
  refreshAllExplanations,
  withInferenceContext,
} from '@aperture/core'
import { syncAllTraktRatings } from '../trakt/index.js'
import { refreshAssistantSuggestions } from '../assistant/jobs/refreshSuggestions.js'
import { releaseJob } from './state.js'

const logger = createChildLogger('jobs-executor')

/**
 * What caused this run. The only thing it currently decides is whether the
 * recommendation pipelines consult the activity gate, but that one decision was
 * previously impossible to express: the gate was hardcoded on inside the
 * all-users loop, so pressing Run in the Jobs console skipped every user whose
 * inputs had not moved and reported success having done nothing.
 *
 * Defaults to 'manual' at every entry point, and only the scheduler's injected
 * executor passes 'scheduled'. That direction matters -- a caller that forgets
 * gets the work done rather than silently getting nothing.
 */
export type JobTrigger = 'scheduled' | 'manual'

/**
 * Run a job, tagging every LLM call it makes — at any depth — with the job that
 * caused it. Almost all background inference goes through here, so this one
 * wrapper is what lets the spend dashboard answer "which job is costing me
 * money" without threading a label through every recommender and enrichment
 * function. See core `lib/inferenceContext.ts`.
 */
export async function runJob(
  name: string,
  jobId: string,
  trigger: JobTrigger = 'manual'
): Promise<void> {
  return withInferenceContext({ feature: `job:${name}` }, () => executeJob(name, jobId, trigger))
}

async function executeJob(name: string, jobId: string, trigger: JobTrigger): Promise<void> {
  const startTime = Date.now()

  try {
    logger.info({ job: name, jobId }, `🚀 Starting job: ${name}`)

    switch (name) {
      case 'sync-users': {
        const result = await syncUsersFromMediaServer(jobId)
        logger.info(
          {
            job: name,
            jobId,
            imported: result.imported,
            updated: result.updated,
            total: result.total,
          },
          `✅ User sync complete`
        )
        break
      }
      case 'sync-movies': {
        const result = await syncMovies(jobId)
        logger.info(
          {
            job: name,
            jobId,
            added: result.added,
            updated: result.updated,
            total: result.total,
          },
          `✅ Movie sync complete`
        )
        break
      }
      case 'generate-movie-embeddings': {
        const result = await generateMissingEmbeddings(jobId)
        logger.info(
          {
            job: name,
            jobId,
            generated: result.generated,
            failed: result.failed,
          },
          `✅ Movie embeddings complete`
        )
        break
      }
      case 'sync-movie-watch-history': {
        const result = await syncWatchHistoryForAllUsers(jobId, true)
        logger.info(
          {
            job: name,
            jobId,
            success: result.success,
            failed: result.failed,
            totalItems: result.totalItems,
          },
          `✅ Movie watch history sync complete`
        )
        break
      }
      case 'generate-movie-recommendations': {
        // The gate belongs to the schedule, not to the job. Pressing Run is
        // someone asking for the work -- including after a deploy that changed
        // what a run stores, which is not one of the gate's signals.
        const result = await generateRecommendationsForAllUsers(jobId, {
          skipIfUnchanged: trigger === 'scheduled',
        })
        logger.info(
          {
            job: name,
            jobId,
            success: result.success,
            failed: result.failed,
            skipped: result.skipped,
          },
          `✅ Movie recommendations complete`
        )
        break
      }
      case 'full-reset-movie-recommendations': {
        const result = await clearAndRebuildAllRecommendations(jobId)
        logger.info(
          {
            job: name,
            jobId,
            cleared: result.cleared,
            success: result.success,
            failed: result.failed,
          },
          `✅ Movie recommendations fully reset`
        )
        break
      }
      case 'sync-movie-libraries': {
        const result = await processStrmForAllUsers(jobId)
        logger.info(
          {
            job: name,
            jobId,
            success: result.success,
            failed: result.failed,
          },
          `✅ Movie libraries sync complete`
        )
        break
      }
      // === Series Jobs ===
      case 'sync-series': {
        const result = await syncSeries(jobId)
        logger.info(
          {
            job: name,
            jobId,
            seriesAdded: result.seriesAdded,
            seriesUpdated: result.seriesUpdated,
            episodesAdded: result.episodesAdded,
            episodesUpdated: result.episodesUpdated,
          },
          `✅ Series sync complete`
        )
        break
      }
      case 'generate-series-embeddings': {
        const result = await generateMissingSeriesEmbeddings(jobId)
        logger.info(
          {
            job: name,
            jobId,
            seriesGenerated: result.seriesGenerated,
            episodesGenerated: result.episodesGenerated,
            failed: result.failed,
          },
          `✅ Series embeddings complete`
        )
        break
      }
      case 'sync-series-watch-history': {
        const result = await syncSeriesWatchHistoryForAllUsers(jobId, true)
        logger.info(
          {
            job: name,
            jobId,
            success: result.success,
            failed: result.failed,
            totalItems: result.totalItems,
          },
          `✅ Series watch history sync complete`
        )
        break
      }
      case 'generate-series-recommendations': {
        const result = await generateSeriesRecommendationsForAllUsers(jobId, {
          skipIfUnchanged: trigger === 'scheduled',
        })
        logger.info(
          {
            job: name,
            jobId,
            success: result.success,
            failed: result.failed,
            skipped: result.skipped,
          },
          `✅ Series recommendations complete`
        )
        break
      }
      case 'full-reset-series-recommendations': {
        const result = await clearAndRebuildAllSeriesRecommendations(jobId)
        logger.info(
          {
            job: name,
            jobId,
            cleared: result.cleared,
            success: result.success,
            failed: result.failed,
          },
          `✅ Series recommendations fully reset`
        )
        break
      }
      case 'sync-series-libraries': {
        const result = await processSeriesStrmForAllUsers(jobId)
        logger.info(
          {
            job: name,
            jobId,
            success: result.success,
            failed: result.failed,
          },
          `✅ Series libraries sync complete`
        )
        break
      }
      // === Explanations only ===
      case 'refresh-recommendation-explanations': {
        const result = await refreshAllExplanations(jobId)
        logger.info(
          {
            job: name,
            jobId,
            runs: result.runs,
            explanations: result.explanations,
            skipped: result.skipped,
            failed: result.failed,
          },
          `✅ Recommendation explanations refreshed`
        )
        break
      }
      // === Title analysis (per title, from retrieved sources, cached forever) ===
      case 'generate-title-analysis': {
        // THE registration this job was missing. Without it `activeJobs` has no
        // entry for this id, and every function in jobs/progress.ts opens with
        // `activeJobs.get(jobId)` and returns silently — so updateJobProgress
        // and addLog were no-ops, completeJob returned before writing the
        // job_runs row (hence "No run history found for this job"), and
        // isJobCancelled was `undefined?.status === 'cancelled'`, which is
        // always false, so Stop could not work however diligently the work
        // polled it. One line missing, every symptom at once.
        //
        // One step, because this job is a single pass over a list; the item
        // counter carries the detail. `setJobStep` leaves itemsTotal at 0 and
        // the first progress report fills it in, since the pending count is not
        // known until the job has done its own counting.
        createJobProgress(jobId, name, 1)
        setJobStep(jobId, 0, 'Analysing titles')

        const result = await generateTitleAnalyses({
          onLog: (level, message) => addLog(jobId, level, message),
          // Cancellation has to be polled BETWEEN titles: a title costs a
          // search, several page fetches and a few thousand tokens of local
          // inference, so per-phase granularity would mean cancelling still
          // costs the rest of the batch.
          shouldCancel: () => isJobCancelled(jobId),
          // The title goes into `currentItem`. Without it the console shows a
          // bar that moves once every 45s-3min and nothing else, which is
          // indistinguishable from a wedged run.
          onProgress: ({ processed, total, currentTitle }) =>
            updateJobProgress(jobId, processed, total, currentTitle),
        })
        logger.info(
          {
            job: name,
            jobId,
            processed: result.processed,
            stored: result.stored,
            declined: result.declined,
            failed: result.failed,
            cancelled: result.cancelled,
            budgetExhausted: result.budgetExhausted,
          },
          `✅ Title analysis pass complete`
        )
        // Reaching a terminal status is what writes the `job_runs` row, so
        // without this the run would sit at 'running' until the five-minute
        // eviction and still leave the history dialog empty. Skipped when
        // cancelled: `cancelJob` has already filed the row, and completing over
        // it would flip a cancelled run to 'completed' — the exact double
        // transition `hasFinished` exists to refuse.
        if (!result.cancelled) {
          completeJob(jobId, { ...result })
        }
        break
      }
      // === Evaluation (reads only; writes nothing anywhere) ===
      case 'evaluate-recommender': {
        // Same registration the title-analysis job was missing: without it
        // every function in jobs/progress.ts silently no-ops on this id.
        createJobProgress(jobId, name, 1)
        setJobStep(jobId, 0, 'Evaluating retrieval')

        // Measure EVERY stored embedding set, not only the active one.
        // Rows are keyed (item, model) inside a per-dimension table, so
        // changing model leaves the previous set in place rather than deleting
        // it -- which is the whole reason two models can be compared without a
        // re-embed in between. An instance holding one set behaves exactly as
        // before; the extra cost is paid only when there is something to
        // compare against.
        // Seeds for the neighbour dump, which the module header calls the
        // PRIMARY instrument. The default is popularSeedIds -- whatever the
        // most people finished -- and that is precisely where two embedding
        // models agree, because a canonical, heavily-written-about film is the
        // easy case both handle. The discriminating seeds are the obscure, the
        // stylistic and the non-English, and popularity structurally excludes
        // all three. So they have to be choosable.
        //
        // Newline-separated, because a film title may contain a comma. Misses
        // are already reported by run.ts, so a wrongly-split list diagnoses
        // itself on the next run rather than silently falling back.
        const seedTitles = await getEvaluationSeedTitles()
        if (seedTitles.length > 0) {
          addLog(jobId, 'info', `🌱 Seeds from settings: ${seedTitles.join(' | ')}`)
        }

        const setsReport = await getEmbeddingSetsReport()
        const stored = setsReport.sets.filter((s) => s.movieCount > 0)
        // No stored set at all falls through to the implicit active-model
        // path, which owns the "nothing to evaluate" message.
        const targets: Array<EmbeddingSetRef | undefined> =
          stored.length > 0
            ? stored.map((s) => ({ modelId: s.model, dimensions: s.dimensions }))
            : [undefined]

        const measured: Array<{ modelId: string; dimensions: number; poolSize: number }> = []
        let result: Awaited<ReturnType<typeof runEvaluation>> = null

        for (const set of targets) {
          if (isJobCancelled(jobId)) break
          const one = await runEvaluation({
            mediaType: 'movie',
            set,
            seedTitles: seedTitles.length > 0 ? seedTitles : undefined,
            // The whole report is written through addLog, because the job log is
            // where it gets read -- in the console and in `docker logs` -- and a
            // structured return value nothing renders would be invisible.
            onLog: (line) => addLog(jobId, 'info', line),
            shouldCancel: () => isJobCancelled(jobId),
          })
          if (one) {
            measured.push({
              modelId: one.modelId,
              dimensions: one.dimensions,
              poolSize: one.poolSize,
            })
            result = one
          }
        }

        // Ranking two sets over two different libraries is not a comparison.
        // A set the embedding job never finished is a smaller pool, and both
        // medianPercentile and ndcg at a deep cutoff read better on one -- so
        // say so rather than letting the table imply a winner.
        if (new Set(measured.map((m) => m.poolSize)).size > 1) {
          addLog(
            jobId,
            'warn',
            `⚠️  Sets cover different numbers of titles (${measured
              .map((m) => `${m.modelId}: ${m.poolSize}`)
              .join(', ')}). Those figures are NOT directly comparable — finish the shorter set first.`
          )
        }

        logger.info(
          {
            job: name,
            jobId,
            // Per set, because poolSize is the confound that decides whether
            // any of these numbers are comparable -- and a bare figure taken
            // from whichever set happened to run last names nothing. The
            // addLog report carries the detail, but this is the line that
            // gets grepped out of docker logs.
            sets: measured,
            // Run-level, and correctly so: the splits are built from watch
            // history and never from a matrix, so every set was scored
            // against the same viewers and the same answer key.
            qualifiedUsers: result?.qualifiedUsers ?? 0,
            skippedUsers: result?.skippedUsers ?? 0,
          },
          `✅ Recommender evaluation complete`
        )
        if (!isJobCancelled(jobId)) {
          completeJob(jobId, {
            qualifiedUsers: result?.qualifiedUsers ?? 0,
            skippedUsers: result?.skippedUsers ?? 0,
          })
        }
        break
      }
      case 'refresh-embedding-centering': {
        // createJobProgress is mandatory: without it every function in
        // jobs/progress.ts silently no-ops on this id -- empty bar, empty log,
        // no job_runs row, and a Stop button that cannot work.
        createJobProgress(jobId, name, 2)

        let step = 0
        const totals: Record<string, number> = {}
        for (const mediaType of ['movie', 'series'] as const) {
          if (isJobCancelled(jobId)) break
          setJobStep(jobId, step++, `Centring ${mediaType} embeddings`)
          addLog(jobId, 'info', `Recomputing the library mean for ${mediaType}...`)
          const { updated, skipped } = await refreshCenteredEmbeddings(mediaType)
          totals[mediaType] = updated
          addLog(
            jobId,
            'info',
            skipped
              ? `No embedding model configured; skipped ${mediaType}`
              : `Recentred ${updated} ${mediaType} embeddings`
          )
        }

        // A rebuild is REQUIRED before any of this reaches a recommendation:
        // profiles keep the space they were built in, so nothing changes until
        // someone runs rebuild-taste-profiles. Said in the log because that is
        // where an operator will look for what to do next.
        addLog(
          jobId,
          'info',
          'Done. No recommendation changes until rebuild-taste-profiles runs -- profiles keep the space they were built in.'
        )

        if (!isJobCancelled(jobId)) {
          completeJob(jobId, totals)
        }
        break
      }
      // === Taste Profiles ===
      case 'rebuild-taste-profiles': {
        const result = await rebuildAllTasteProfiles(jobId)
        logger.info(
          {
            job: name,
            jobId,
            usersProcessed: result.usersProcessed,
            rebuilt: result.rebuilt,
            skippedLocked: result.skippedLocked,
            skippedNoData: result.skippedNoData,
            failed: result.failed,
          },
          `✅ Taste profile rebuild complete`
        )
        break
      }
      // === Top Picks Jobs ===
      case 'refresh-top-picks': {
        const result = await refreshTopPicks(jobId)
        logger.info(
          {
            job: name,
            jobId,
            moviesCount: result.moviesCount,
            seriesCount: result.seriesCount,
            usersUpdated: result.usersUpdated,
          },
          `✅ Top Picks refresh complete`
        )
        break
      }
      case 'auto-request-top-picks': {
        const { runAutoRequestJob } = await import('@aperture/core')
        const result = await runAutoRequestJob(jobId)
        logger.info(
          {
            job: name,
            jobId,
            moviesRequested: result.moviesRequested,
            seriesRequested: result.seriesRequested,
            moviesSkipped: result.moviesSkipped,
            seriesSkipped: result.seriesSkipped,
          },
          `✅ Auto-request Top Picks complete`
        )
        break
      }
      // === LLDAP Email Sync Job ===
      case 'sync-lldap-emails': {
        const result = await syncLldapEmails(jobId)
        logger.info(
          {
            job: name,
            jobId,
            matched: result.matched,
            updated: result.updated,
            skipped: result.skipped,
          },
          `✅ LLDAP email sync complete`
        )
        break
      }
      // === Trakt Sync Job ===
      case 'sync-trakt-ratings': {
        const result = await syncAllTraktRatings(jobId)
        logger.info(
          {
            job: name,
            jobId,
            usersProcessed: result.usersProcessed,
            ratingsImported: result.ratingsImported,
            errors: result.errors,
          },
          `✅ Trakt ratings sync complete`
        )
        break
      }
      case 'sync-watching-favorites': {
        const result = await processWatchingFavoritesForAllUsers(jobId)
        logger.info(
          {
            job: name,
            jobId,
            success: result.success,
            failed: result.failed,
            users: result.users.length,
          },
          `✅ Watching favorites sync complete`
        )
        break
      }
      // === Assistant Suggestions Job ===
      case 'refresh-assistant-suggestions': {
        const result = await refreshAssistantSuggestions(jobId)
        logger.info(
          {
            job: name,
            jobId,
            usersProcessed: result.usersProcessed,
            errors: result.errors,
          },
          `✅ Assistant suggestions refresh complete`
        )
        break
      }
      // === Ratings refresh (the numbers that move, unlike metadata) ===
      case 'refresh-ratings': {
        // Sized from RATING_SOURCE_IDS rather than a literal, because the
        // executor has to create the progress record before the job reads its
        // own config: a hand-written count here is the second copy that stops
        // matching, and the bar then finishes at 50% or runs past 100%.
        // Disabled sources still report a step, so the bar advances past them.
        createJobProgress(jobId, name, RATING_SOURCE_IDS.length)

        const result = await refreshRatings({
          onLog: (level, message) => addLog(jobId, level, message),
          onStep: (index, label) => setJobStep(jobId, index, label),
          // Cancellation is polled inside the scan and between writes. An 8 MB
          // download plus 1.5M lines is a minute or so, which is long enough
          // that Stop has to do something observable.
          shouldCancel: () => isJobCancelled(jobId),
          onProgress: (processed, total, currentItem) =>
            updateJobProgress(jobId, processed, total, currentItem),
        })
        logger.info(
          {
            job: name,
            jobId,
            sourcesRun: result.sourcesRun,
            sourcesFailed: result.sourcesFailed,
            sourcesSkipped: result.sourcesSkipped,
            imdbMatched: result.imdb?.matched,
            imdbMoviesUpdated: result.imdb?.moviesUpdated,
            imdbSeriesUpdated: result.imdb?.seriesUpdated,
            cancelled: result.cancelled,
          },
          `✅ Ratings refresh complete`
        )
        // Skipped when cancelled: cancelJob has already filed the job_runs row,
        // and completing over it would flip a cancelled run to 'completed'.
        if (!result.cancelled) {
          completeJob(jobId, { ...result })
        }
        break
      }
      // === Metadata Enrichment Job ===
      case 'enrich-metadata': {
        const result = await enrichMetadata(jobId)
        logger.info(
          {
            job: name,
            jobId,
            moviesEnriched: result.moviesEnriched,
            seriesEnriched: result.seriesEnriched,
            collectionsCreated: result.collectionsCreated,
          },
          `✅ Metadata enrichment complete`
        )
        break
      }
      // === Studio Logo Enrichment Job ===
      case 'enrich-studio-logos': {
        const result = await enrichStudioLogos(jobId)
        logger.info(
          {
            job: name,
            jobId,
            studiosEnriched: result.studiosEnriched,
            networksEnriched: result.networksEnriched,
            logosPushedToEmby: result.logosPushedToEmby,
          },
          `✅ Studio logo enrichment complete`
        )
        break
      }
      // === MDBList Enrichment Job ===
      case 'enrich-mdblist': {
        const result = await enrichMDBListMetadata(jobId)
        logger.info(
          {
            job: name,
            jobId,
            moviesEnriched: result.moviesEnriched,
            seriesEnriched: result.seriesEnriched,
          },
          `✅ MDBList enrichment complete`
        )
        break
      }
      // === Database Backup Job ===
      case 'backup-database': {
        const result = await createBackup()
        if (!result.success) {
          throw new Error(result.error || 'Backup failed')
        }
        logger.info(
          {
            job: name,
            jobId,
            filename: result.filename,
            sizeBytes: result.sizeBytes,
            duration: result.duration,
          },
          `✅ Database backup complete`
        )
        break
      }
      // === Auth Cleanup Job ===
      case 'cleanup-auth-state': {
        const result = await cleanupExpiredAuthState()
        completeJob(jobId, { ...result })
        logger.info({ job: name, jobId, ...result }, `✅ Auth cleanup complete`)
        break
      }
      // === AI Pricing Cache Job ===
      case 'refresh-ai-pricing': {
        createJobProgress(jobId, 'refresh-ai-pricing', 2)

        setJobStep(jobId, 0, 'Checking cache status')
        const statusBefore = await getPricingCacheStatus()
        addLog(
          jobId,
          'info',
          `Current cache: ${statusBefore.cached ? `${statusBefore.modelCount} models` : 'empty'}${statusBefore.isStale ? ' (stale)' : ''}`
        )

        setJobStep(jobId, 1, 'Fetching pricing data from Helicone API')
        addLog(jobId, 'info', '🔄 Fetching latest pricing data...')

        await refreshPricingCache()

        const statusAfter = await getPricingCacheStatus()
        addLog(jobId, 'info', `✅ Loaded ${statusAfter.modelCount} model pricing entries`)

        completeJob(jobId, {
          modelCount: statusAfter.modelCount,
          fetchedAt: statusAfter.fetchedAt?.toISOString(),
          cached: statusAfter.cached,
        })

        logger.info(
          {
            job: name,
            jobId,
            cached: statusAfter.cached,
            modelCount: statusAfter.modelCount,
            fetchedAt: statusAfter.fetchedAt,
          },
          `✅ AI pricing cache refreshed`
        )
        break
      }
      // === Discovery Suggestions Job ===
      case 'refresh-library-gaps': {
        createJobProgress(jobId, 'refresh-library-gaps', 4)
        const result = await runLibraryGapAnalysis({ jobId })
        completeJob(jobId, {
          runId: result.runId,
          collectionsScanned: result.collectionsScanned,
          totalParts: result.totalParts,
          ownedParts: result.ownedParts,
          missingCount: result.missingCount,
        })
        logger.info(
          {
            job: name,
            jobId,
            runId: result.runId,
            missingCount: result.missingCount,
          },
          `✅ Library gap analysis complete`
        )
        break
      }
      case 'generate-discovery-suggestions': {
        createJobProgress(jobId, 'generate-discovery-suggestions', 2)

        setJobStep(jobId, 0, 'Checking prerequisites')
        addLog(jobId, 'info', '🔍 Checking Seerr configuration and user enablement...')

        const result = await generateDiscoveryForAllUsers(DEFAULT_DISCOVERY_CONFIG, jobId)

        if (result.success === 0 && result.failed === 0) {
          addLog(
            jobId,
            'warn',
            '⚠️ No users have discovery enabled. Enable discovery for users in Admin → Users.'
          )
        }

        setJobStep(jobId, 1, 'Complete')
        completeJob(jobId, {
          success: result.success,
          failed: result.failed,
        })

        logger.info(
          {
            job: name,
            jobId,
            success: result.success,
            failed: result.failed,
          },
          `✅ Discovery suggestions generation complete`
        )
        break
      }
      default:
        throw new Error(`Unknown job: ${name}`)
    }

    const duration = Date.now() - startTime
    logger.info({ job: name, jobId, duration }, `🏁 Job completed: ${name} (${duration}ms)`)
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ job: name, jobId, err }, `❌ Job failed: ${name}`)
    failJob(jobId, error)
    throw err
  } finally {
    releaseJob(name, jobId)
  }
}
