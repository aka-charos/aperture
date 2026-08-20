/**
 * The ratings refresh pass: one job, sources as steps.
 *
 * WHY ONE JOB AND NOT ONE PER SOURCE. An operator thinks "refresh my ratings",
 * not "run IMDb, then run MDBList" — so it is one card, one schedule, one
 * history. It also means adding a source later adds a step rather than another
 * card, another `JOB_CATEGORIES` entry and another thing to forget. The
 * precedent is `enrichMetadata`, which already runs TMDb and OMDb inside one
 * job with a per-source enabled flag and a per-source stamp; this is the same
 * structure applied to the data that moves instead of the data that does not.
 *
 * The two objections to a single job are both handled inside it. Different
 * failure modes: a source that throws is logged and the next step still runs.
 * Different cadences: not a real tension here, since the dataset is one 8 MB
 * GET and MDBList's batch endpoint is 126 calls for the whole library, so both
 * sit comfortably on one daily schedule.
 *
 * NOTHING ENABLED IS NOT A FAILURE. Every source is opt-in, so a scheduled run
 * on a fresh install has nothing to do; it says so and exits cleanly. Failing
 * there would put a red job on the console for a correctly configured instance
 * that simply has not opted in.
 *
 * ALL ENABLED SOURCES FAILING *IS* A FAILURE, and has to throw so the executor
 * files the run as failed. The shape to avoid is the one the title-analysis job
 * hit: a pass where every unit of work failed, which logged a cheerful
 * completion because the loop itself had not thrown.
 */
import { createChildLogger } from '../lib/logger.js'
import {
  RATING_SOURCE_IDS,
  getRatingsRefreshConfig,
  hasEnabledRatingSource,
  type RatingSourceId,
} from './config.js'
import { refreshImdbRatings, type ImdbRefreshResult } from './imdbDataset.js'

const logger = createChildLogger('ratings-refresh')

export interface RatingsRefreshOptions {
  shouldCancel?: () => boolean
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void
  /** Step index within RATING_SOURCE_IDS, so the console names the running source. */
  onStep?: (index: number, name: string) => void
  onProgress?: (processed: number, total: number, currentItem?: string) => void
}

export interface RatingsRefreshResult {
  /** Sources that were switched on and reached the end without throwing. */
  sourcesRun: number
  sourcesFailed: number
  /** Switched off, and therefore skipped rather than attempted. */
  sourcesSkipped: number
  imdb?: ImdbRefreshResult
  cancelled: boolean
}

/** Display names, only for logs and the progress step label. */
const SOURCE_LABELS: Record<RatingSourceId, string> = {
  imdbDataset: 'IMDb dataset',
}

export async function refreshRatings(
  options: RatingsRefreshOptions = {}
): Promise<RatingsRefreshResult> {
  const { shouldCancel, onLog, onStep, onProgress } = options
  const log = (level: 'info' | 'warn' | 'error', message: string) => {
    onLog?.(level, message)
    logger[level](message)
  }

  const config = await getRatingsRefreshConfig()
  const result: RatingsRefreshResult = {
    sourcesRun: 0,
    sourcesFailed: 0,
    sourcesSkipped: 0,
    cancelled: false,
  }

  if (!hasEnabledRatingSource(config)) {
    log('warn', 'No rating sources are enabled - nothing to refresh')
    result.sourcesSkipped = RATING_SOURCE_IDS.length
    return result
  }

  for (const [index, source] of RATING_SOURCE_IDS.entries()) {
    if (result.cancelled) break

    const label = SOURCE_LABELS[source]
    if (!config[source]) {
      result.sourcesSkipped++
      // Reported as a step anyway, so the bar advances past a disabled source
      // rather than appearing to stall on it.
      onStep?.(index, `${label} (disabled)`)
      continue
    }

    onStep?.(index, label)

    try {
      switch (source) {
        case 'imdbDataset': {
          const imdb = await refreshImdbRatings({
            shouldCancel,
            onLog,
            onProgress: ({ matched, wanted }) => onProgress?.(matched, wanted, label),
          })
          result.imdb = imdb
          if (imdb.cancelled) result.cancelled = true
          break
        }
      }
      result.sourcesRun++
    } catch (error) {
      // Logged and carried on: one source being unreachable should not stop the
      // others from running. Whether the JOB failed is decided below, on the
      // totals, not here on the first exception.
      result.sourcesFailed++
      const message = error instanceof Error ? error.message : String(error)
      log('error', `${label} failed: ${message}`)
      logger.error({ error, source }, 'Rating source failed')
    }
  }

  if (result.sourcesRun === 0 && result.sourcesFailed > 0) {
    throw new Error(
      `Every enabled rating source failed (${result.sourcesFailed} of ${result.sourcesFailed})`
    )
  }

  return result
}
