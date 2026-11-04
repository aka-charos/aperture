/**
 * How long a title analysis took, per phase (0217). Pure, so the rules are
 * pinned without a clock or a database.
 *
 * Two figures, never one mixed total: `retrievalMs` is the search and page
 * fetches, `writeMs` the model. Only the second can compare models, and an
 * offsite import has only the second.
 */

export interface AnalysisTiming {
  /** Null in grounding mode and on offsite imports: no separate phase was timed. */
  retrievalMs: number | null
  /** Null on rows older than the columns and offsite results that don't say. */
  writeMs: number | null
}

/** The most an INTEGER column holds. A figure past it is junk, not a long run. */
const MAX_STORABLE_MS = 2_147_483_647

/**
 * Time spent in a phase on a monotonic clock, less the part spent paused.
 * `pausedMs` comes from another clock, so the subtraction can undershoot by a
 * little; a phase never reads as negative.
 */
export function phaseMs(startedAt: number, now: number, pausedMs = 0): number {
  return Math.max(0, Math.round(now - startedAt - pausedMs))
}

/** Both phases when both ran, the writing alone when it is all there is. Null = unmeasured. */
export function totalAnalysisMs(timing: AnalysisTiming): number | null {
  if (timing.writeMs == null) return null
  return timing.writeMs + (timing.retrievalMs ?? 0)
}

/**
 * A runner's `elapsed_ms`, or null. Any tool can write a results file, so the
 * value is checked rather than trusted: one the column cannot hold would fail
 * the whole row's INSERT over a figure nobody needs.
 */
export function readElapsedMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const ms = Math.round(value)
  return ms <= MAX_STORABLE_MS ? ms : null
}

/** The error Postgres raises when the image is ahead of migration 0217. */
export function isMissingTimingColumn(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const { code, message } = err as { code?: unknown; message?: unknown }
  return code === '42703' && typeof message === 'string' && /\b(?:retrieval|write)_ms\b/.test(message)
}

/**
 * Run a statement with the timing columns, again without them if the database
 * doesn't have them yet. Losing a figure beats failing every read of an analysis
 * and throwing away an answer the model has already been paid for.
 */
export async function withAnalysisTiming<T>(
  run: (withTiming: boolean) => Promise<T>,
  onMissing: (err: unknown) => void
): Promise<T> {
  try {
    return await run(true)
  } catch (err) {
    if (!isMissingTimingColumn(err)) throw err
    onMissing(err)
    return run(false)
  }
}
