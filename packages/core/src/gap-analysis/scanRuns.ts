/**
 * What the movie and TV gap scans share: how a run row is closed, replaced or thrown
 * away, and when TMDb's silence means a scan must not finish. Each scan keeps only what
 * is its own, the comparison.
 *
 * A snapshot is replaced only by a finished scan, so anything that goes wrong leaves the
 * last good list up.
 */

import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'

const logger = createChildLogger('gap-analysis-runs')

/** Whole batches with no answer before a scan stops: TMDb is down or the key is bad. */
export const MAX_UNANSWERED_BATCHES = 3
/** Collections a scan may lose before it stops being worth more than the last snapshot. */
export const MAX_UNREADABLE_SHARE = 0.1
/** So that one or two bad ids cannot make a small library impossible to scan. */
export const MIN_UNREADABLE_ALLOWED = 3

export const INTERRUPTED_MESSAGE = 'The scan was interrupted by a restart.'
export const TMDB_SILENT_MESSAGE = 'TMDb stopped answering. Check the API key and try again.'
export const TMDB_PARTIAL_MESSAGE = 'TMDb answered too little of this scan to replace the last results. Try again later.'
export const RUN_GONE_MESSAGE = 'This scan was closed or removed while it was running.'

/** The failures the page can word itself; any other message is shown as the server wrote it. */
export type ScanFailureReason = 'interrupted' | 'tmdbSilent' | 'tmdbPartial'

export function scanFailureReason(message: string | null): ScanFailureReason | null {
  if (message === INTERRUPTED_MESSAGE) return 'interrupted'
  if (message === TMDB_SILENT_MESSAGE) return 'tmdbSilent'
  if (message === TMDB_PARTIAL_MESSAGE) return 'tmdbPartial'
  return null
}

/** How many lookups a scan may leave unanswered, with nothing stored to stand in for them. */
export function unreadableAllowed(total: number): number {
  return Math.max(MIN_UNREADABLE_ALLOWED, Math.floor(total * MAX_UNREADABLE_SHARE))
}

/**
 * Tells an outage from a library with little in it. Silence reads as "nothing to report"
 * otherwise, and finishing on that would replace a good snapshot with nothing.
 */
export function tmdbSilenceGuard() {
  let batches = 0
  let answered = 0
  let silentInARow = 0
  return {
    /** Throws once enough whole batches have gone unanswered. */
    afterBatch(answeredInBatch: number): void {
      batches++
      answered += answeredInBatch
      silentInARow = answeredInBatch === 0 ? silentInARow + 1 : 0
      if (silentInARow >= MAX_UNANSWERED_BATCHES) throw new Error(TMDB_SILENT_MESSAGE)
    },
    /** Throws for a library too small to reach the batch limit. */
    atEnd(): void {
      if (batches > 0 && answered === 0) throw new Error(TMDB_SILENT_MESSAGE)
    },
    /** What to say when too much went unread: a bad key is not a partial answer. */
    tooLittleRead(): Error {
      return new Error(answered > 0 ? TMDB_PARTIAL_MESSAGE : TMDB_SILENT_MESSAGE)
    },
  }
}

/** One scan's run table. The names are the module's own constants, never input. */
export function scanRunStore(tables: { runs: string; results: string }) {
  const { runs, results } = tables

  /** Records a failure and never throws: the caller is rethrowing the error that matters. */
  async function fail(runId: string, message: string): Promise<void> {
    try {
      await query(
        `UPDATE ${runs}
         SET status = 'failed', completed_at = NOW(), error_message = $2
         WHERE id = $1`,
        [runId, message]
      )
      await query(`DELETE FROM ${results} WHERE run_id = $1`, [runId])
    } catch (err) {
      logger.error({ err, runId, table: runs }, 'Could not record a failed gap scan')
    }
  }

  return {
    fail,

    /** The scan that failed since the last good one, so the page can say so. */
    async latestFailed<Row extends object>(): Promise<Row | null> {
      return queryOne<Row>(
        `SELECT * FROM ${runs} f
         WHERE f.status = 'failed'
           AND NOT EXISTS (
             SELECT 1 FROM ${runs} c
             WHERE c.status = 'completed' AND c.completed_at > f.started_at
           )
         ORDER BY f.started_at DESC LIMIT 1`
      )
    },

    /**
     * At boot and after a restore: a row still `running` belongs to a process that died
     * mid-scan, and closing it lets the page say the scan failed. Reads never call this
     * and never need to, because they ask the job slot whether a scan is alive. Never
     * throws, so it cannot stop a boot: with migrations off, the table may not exist yet.
     */
    async closeInterrupted(): Promise<void> {
      try {
        const open = await query<{ id: string }>(`SELECT id FROM ${runs} WHERE status = 'running'`)
        for (const row of open.rows) await fail(row.id, INTERRUPTED_MESSAGE)
      } catch (err) {
        logger.warn({ err, table: runs }, 'Could not close interrupted gap scans')
      }
    },

    /** The job slot is the caller's, so anything still open or failed is from an earlier scan. */
    async clearLeftovers(): Promise<void> {
      await query(`DELETE FROM ${runs} WHERE status IN ('running', 'failed')`)
    },

    /** A cancelled scan keeps nothing: the last finished snapshot is still the page's answer. */
    async discard(runId: string): Promise<void> {
      await query(`DELETE FROM ${runs} WHERE id = $1`, [runId])
    },

    /**
     * Finishes a run, then replaces every older one (results go with their run, ON DELETE
     * CASCADE). The replacing needs this run to be the one that finished: a restore or a
     * later scan can remove or close its row, and deleting "everything else" then would
     * take the last good snapshot with it.
     */
    async finishAndReplace(runId: string): Promise<void> {
      const finished = await query<{ id: string }>(
        `UPDATE ${runs} SET status = 'completed', completed_at = NOW()
         WHERE id = $1 AND status = 'running'
         RETURNING id`,
        [runId]
      )
      if (finished.rows.length === 0) throw new Error(RUN_GONE_MESSAGE)
      await query(`DELETE FROM ${runs} WHERE id <> $1`, [runId])
    },
  }
}
