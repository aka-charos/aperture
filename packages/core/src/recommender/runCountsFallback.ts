/**
 * Write a recommendation run with its gate counts, or without them when the
 * schema predates them (0203).
 *
 * A run written without counts reads as "counts unknown" to the gate, which
 * regenerates: the safe direction, and exactly how every run made before 0203
 * already reads. So the only cost of the fallback is that the gate cannot skip
 * those viewers until the migration runs, where the cost of failing would be
 * that nobody gets recommendations at all.
 */

import { createChildLogger } from '../lib/logger.js'
import { isMissingRunCountsColumn } from './gateCounts.js'

const logger = createChildLogger('recommendation-run-counts')

let warned = false

export async function withRunCounts<T>(write: (withCounts: boolean) => Promise<T>): Promise<T> {
  try {
    return await write(true)
  } catch (err) {
    if (!isMissingRunCountsColumn(err)) throw err
    if (!warned) {
      warned = true
      logger.warn(
        { err },
        'recommendation_runs has no input_counts/output_counts column (migration 0203 not applied); ' +
          'writing runs without them, so the activity gate regenerates everyone until it is applied'
      )
    }
    return write(false)
  }
}
