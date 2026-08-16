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
 * 3. THE BUDGET IS A CALL COUNT, NOT A ROW COUNT. Declines, empty-text retries
 *    and quota failures all consume Google's daily allowance, so counting
 *    stored analyses would systematically overrun it.
 */
import { createChildLogger } from '../lib/logger.js'
import { analyseTitle } from './generate.js'
import { countPendingAnalysis, selectPendingTitles } from './titles.js'

const logger = createChildLogger('title-analysis-job')

/**
 * Grounded search carries a far tighter daily cap than the model's own request
 * limit, and it is per Google project. Conservative by default: the job is
 * meant to trickle through the library over weeks, and an operator who wants it
 * faster can raise this or add more keys.
 */
export const DEFAULT_DAILY_BUDGET = 200

/** How many pending rows to fetch at a time. Small — priority order shifts. */
const SELECT_BATCH = 25

export interface AnalysisJobOptions {
  /** Maximum grounded calls this run may make. */
  budget?: number
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
  const budget = options.budget ?? DEFAULT_DAILY_BUDGET
  const mediaTypes = options.mediaTypes ?? ['movie', 'series']

  const result: AnalysisJobResult = {
    processed: 0,
    stored: 0,
    declined: 0,
    failed: 0,
    cancelled: false,
    budgetExhausted: false,
  }

  // Totals come from the same predicate the selection uses, so the progress
  // bar cannot describe a total the loop never reaches.
  let total = 0
  for (const mediaType of mediaTypes) {
    total += await countPendingAnalysis(mediaType)
  }
  const capped = Math.min(total, budget)

  const report = () =>
    options.onProgress?.({
      processed: result.processed,
      stored: result.stored,
      declined: result.declined,
      failed: result.failed,
      total: capped,
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
        result.processed++

        try {
          const stored = await analyseTitle(title.mediaType, title.mediaId, title.subject)
          if (stored.analysis) result.stored++
          else result.declined++
        } catch (err) {
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
