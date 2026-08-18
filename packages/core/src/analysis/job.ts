/**
 * The batch pass: walk the library writing grounded analysis, in priority
 * order, inside a daily call budget.
 *
 * Three properties are load-bearing and each one is a bug this repo has already
 * paid for once:
 *
 * 1. EVERY ROW IS ATTEMPTED AT MOST ONCE PER RUN. A transport failure writes no
 *    row, deliberately, so the title stays pending — which means a loop reading
 *    until the pending selection empties would spin on it forever. That is
 *    exactly how `enrichMetadata`'s `while (true)` loops became non-terminating,
 *    and over-stamping failures was the accident that had been hiding it.
 *
 * 2. CANCELLATION IS POLLED BETWEEN TITLES. Cancelling is cooperative: it sets
 *    a status and nothing interrupts an in-flight HTTP call. For a job that is
 *    minutes long and every step of which is a paid grounded request, the poll
 *    has to sit between calls, not between phases.
 *
 * 3. THE CAP COUNTS ATTEMPTS, NOT STORED ROWS. Declines and failures cost the
 *    same retrieval and inference time a success does, so counting only stored
 *    analyses would let a run of declines take many times longer than asked.
 *
 * WHAT THE CAP IS FOR NOW. It used to ration a per-day grounding quota. With
 * retrieval and inference both self-hosted there is no quota — the limit is
 * wall-clock time, since a title costs one search, several page fetches and a
 * few thousand tokens through a local model, so ~1-3 minutes each. The default
 * is therefore sized as "a long overnight run", not as anyone's allowance.
 */
import { createChildLogger } from '../lib/logger.js'
import { AnalysisCancelledError, analyseTitle } from './generate.js'
import { checkModeReadiness } from './mode.js'
import { countPendingAnalysis, selectPendingTitles } from './titles.js'

const logger = createChildLogger('title-analysis-job')

/**
 * Titles attempted per run, unless the caller says otherwise.
 *
 * 200 is roughly an overnight pass at 1-3 minutes a title. Nothing breaks if it
 * is raised — there is no quota to overrun — but a run that outlives the gap to
 * its next schedule is a job overlapping itself, which is the actual failure to
 * avoid. The real throughput limits are the operator's GPU and, more likely,
 * SearXNG's upstream engines throttling a fast crawl.
 */
export const DEFAULT_MAX_TITLES_PER_RUN = 200

/** How many pending rows to fetch at a time. Small — priority order shifts. */
const SELECT_BATCH = 25

export interface AnalysisJobOptions {
  /** Maximum titles this run may attempt. */
  maxTitles?: number
  /** Media types to cover, in order. */
  mediaTypes?: Array<'movie' | 'series'>
  /** Polled between titles; returning true stops the run cleanly. */
  shouldCancel?: () => Promise<boolean> | boolean
  /** Progress reporting, for the jobs console. */
  onProgress?: (progress: {
    processed: number
    stored: number
    declined: number
    failed: number
    total: number
    /**
     * The title currently being worked on.
     *
     * Load-bearing for a job of this shape, not decoration. A title takes 45
     * seconds to three minutes, so a bare counter moves once in that window and
     * a run genuinely working looks identical to one wedged. The console has a
     * label field for exactly this (`updateJobProgress`'s `currentItem`) and
     * this job was passing nothing into it.
     */
    currentTitle?: string
  }) => void
}

export interface AnalysisJobResult {
  processed: number
  stored: number
  declined: number
  failed: number
  cancelled: boolean
  budgetExhausted: boolean
}

export async function generateTitleAnalyses(
  options: AnalysisJobOptions = {}
): Promise<AnalysisJobResult> {
  const budget = options.maxTitles ?? DEFAULT_MAX_TITLES_PER_RUN
  const mediaTypes = options.mediaTypes ?? ['movie', 'series']

  const result: AnalysisJobResult = {
    processed: 0,
    stored: 0,
    declined: 0,
    failed: 0,
    cancelled: false,
    budgetExhausted: false,
  }

  // Fail the whole run once, before any work, when the mode cannot run at all.
  // `analyseTitle` checks this too — it is the choke point every path goes
  // through — but discovering it per title would spend the entire budget on
  // identical failures and bury the reason under 200 stack traces. The message
  // is the operator-facing sentence from `checkModeReadiness`, and the executor
  // puts it on the job card.
  const readiness = await checkModeReadiness()
  if (!readiness.ready) {
    logger.error({ mode: readiness.mode, reason: readiness.reason }, 'Title analysis cannot run')
    throw new Error(readiness.reason ?? 'Title analysis is not configured')
  }

  // Totals come from the same predicate the selection uses, so the progress
  // bar cannot describe a total the loop never reaches.
  let total = 0
  for (const mediaType of mediaTypes) {
    total += await countPendingAnalysis(mediaType)
  }
  const capped = Math.min(total, budget)

  const report = (currentTitle?: string) =>
    options.onProgress?.({
      processed: result.processed,
      stored: result.stored,
      declined: result.declined,
      failed: result.failed,
      total: capped,
      currentTitle,
    })

  report()

  for (const mediaType of mediaTypes) {
    // Per media type, since a movie id and a series id are different keyspaces.
    const attempted = new Set<string>()

    while (result.processed < budget) {
      if (await isCancelled(options)) {
        result.cancelled = true
        return result
      }

      const remaining = budget - result.processed
      const titles = await selectPendingTitles(
        mediaType,
        Math.min(SELECT_BATCH, remaining),
        [...attempted]
      )
      if (titles.length === 0) break

      for (const title of titles) {
        if (result.processed >= budget) break
        if (await isCancelled(options)) {
          result.cancelled = true
          return result
        }

        attempted.add(title.mediaId)
        // Announced BEFORE the work, so the console names what it is chewing on
        // for the minute it takes rather than only after it finishes.
        report(title.subject.title)
        result.processed++

        try {
          const stored = await analyseTitle(title.mediaType, title.mediaId, title.subject, {
            shouldCancel: options.shouldCancel,
          })
          if (stored.analysis) result.stored++
          else result.declined++
        } catch (err) {
          // Stopped on request part-way through, not a broken title. The row is
          // unwritten either way, so it stays pending; the difference is that
          // this ends the run instead of counting against it.
          if (err instanceof AnalysisCancelledError) {
            result.processed--
            result.cancelled = true
            report()
            return result
          }
          // No row was written, so this title stays pending and the NEXT run
          // picks it up — which is the entire reason a failure must not be
          // stored as a decline. `attempted` is what keeps this run finite.
          result.failed++
          logger.warn(
            { err, mediaType, mediaId: title.mediaId, title: title.subject.title },
            'Title analysis failed; leaving it pending for the next run'
          )
        }

        report()
      }
    }
  }

  result.budgetExhausted = result.processed >= budget

  logger.info(
    {
      processed: result.processed,
      stored: result.stored,
      declined: result.declined,
      failed: result.failed,
      budget,
      budgetExhausted: result.budgetExhausted,
    },
    'Title analysis pass finished'
  )

  return result
}

async function isCancelled(options: AnalysisJobOptions): Promise<boolean> {
  if (!options.shouldCancel) return false
  return (await options.shouldCancel()) === true
}

/** Pending counts per media type, for the jobs console and the settings page. */
export async function getAnalysisStatus(): Promise<{
  pendingMovies: number
  pendingSeries: number
}> {
  const [pendingMovies, pendingSeries] = await Promise.all([
    countPendingAnalysis('movie'),
    countPendingAnalysis('series'),
  ])
  return { pendingMovies, pendingSeries }
}
