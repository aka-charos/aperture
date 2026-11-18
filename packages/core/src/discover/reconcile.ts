/**
 * Discovery Request Reconciliation
 *
 * Brings `discovery_requests.status` back in line with what Seerr actually
 * decided.
 *
 * Why this exists: the discovery filter excludes any title whose request is not
 * in a terminal state (`getRequestedTmdbIds` skips only 'declined' and
 * 'failed'), which is correct in intent -- there is no point suggesting
 * something the user has already asked for. But the only thing that ever
 * advanced a request's status was someone loading
 * `GET /api/seerr/request/:requestId/status` for that one request, or opening
 * the requests list. Nothing swept them.
 *
 * So a request Seerr declined stayed 'submitted' in Aperture forever, and the
 * title was suppressed from every future run with no way back and nothing on
 * screen explaining why. From the user's side a title simply disappeared from
 * Discover.
 */

import { createChildLogger } from '../lib/logger.js'
import { query, transaction } from '../lib/db.js'
import { lookupRequestStatus, seerrAnswersAtAddress } from '../seerr/index.js'
import type { SeerrLiveRequestStatus } from '../seerr/index.js'
import { listUnconfirmedRequests, settleUnconfirmedBatch } from '../seerr/submission.js'
import type { DiscoveryRequestStatus } from './types.js'

const logger = createChildLogger('discover:reconcile')

/**
 * Statuses that can still change. 'declined', 'failed' and 'available' are
 * end states -- Seerr will not move them again, so re-checking them would spend
 * a request per row per run for nothing. (A failed row that still names a
 * Seerr request is the exception, checked in its own batch: FAILED_RECHECK_LIMIT.)
 */
const NON_TERMINAL_STATUSES: DiscoveryRequestStatus[] = ['pending', 'submitted', 'approved']

/**
 * How long a request with no Seerr id may sit before it is written off.
 *
 * A row is created before submission and only then given its `seerr_request_id`
 * (see createDiscoveryRequest, then the submit handler). If submission threw,
 * the row is stranded at 'pending' with no id, unreconcilable and -- because
 * 'pending' is not terminal -- suppressing its title permanently. After this
 * long the honest reading is that the submission never happened, so it is
 * marked 'failed' and the title becomes suggestable again.
 *
 * Generous on purpose: the cost of waiting is one title missing from Discover
 * for a day, and the cost of being hasty is writing off a request that was
 * actually in flight.
 *
 * A row Seerr never answered for (`seerr_unconfirmed_since`, 0223) is not
 * written off blind: it may exist in Seerr. Those are settled against the
 * title's own requests in Seerr instead (core `seerr/submission.ts`).
 */
const STRANDED_PENDING_HOURS = 24

/** Requests reconciled in one pass, so a large backlog cannot stall the job. */
const RECONCILE_BATCH_LIMIT = 500

/**
 * Failed rows with a Seerr request id re-checked per pass. These are requests
 * deleted in Seerr, plus any an unanswered lookup once failed wrongly; a
 * deleted one costs one lookup per night until the batch comes round again.
 */
const FAILED_RECHECK_LIMIT = 100

export interface ReconcileResult {
  checked: number
  updated: number
  strandedFailed: number
  /** Unanswered requests found in Seerr and recorded as submitted. */
  unconfirmedFound: number
  /** Unanswered requests Seerr has no record of, recorded as failed. */
  unconfirmedFailed: number
  unreachable: number
  cancelled: boolean
}

/**
 * Map a live Seerr response onto our status vocabulary.
 *
 * Media availability wins over request state: an 'approved' request whose media
 * has finished importing is 'available', and that is the more useful fact. A
 * completed request is too: a request for some seasons finishes while the show as a
 * whole stays partly available. Kept pure and exported so the precedence is testable
 * without a Seerr instance.
 */
export function resolveRequestStatus(
  current: DiscoveryRequestStatus,
  live: { status: 'pending' | 'approved' | 'declined' | 'completed'; mediaStatus: string }
): DiscoveryRequestStatus {
  if (live.mediaStatus === 'available' || live.status === 'completed') return 'available'
  if (live.status === 'declined') return 'declined'
  if (live.status === 'approved') return 'approved'
  // Seerr still says pending. Don't walk a request backwards from whatever we
  // already recorded -- 'submitted' is our own word for the same state. A row
  // recorded as failed is the exception: Seerr holds the request, so it did not
  // fail (an unanswered lookup used to be written down as a deleted request).
  return current === 'pending' || current === 'failed' ? 'submitted' : current
}

/**
 * Whether restoring a row recorded as failed, while Seerr kept the request,
 * keeps the row's `status_changed_at`.
 *
 * Request notifications fire off that stamp (core notifications/events.ts), and
 * the trigger moves it on every status change. A row failed on a Seerr 404
 * records the status it held (`failed_from`, 0225): coming back to that same
 * status is a correction, already announced when it first happened, so it
 * keeps the stamp. Coming back to a different one is a decision made since,
 * never announced, so it is announced now. Arrival always counts as news: a
 * failed row was never available.
 *
 * A row failed before 0225 has no `failed_from`. For those, Seerr's own last
 * change to the request stands in: at or before the failure (the stamp of a
 * failed row) keeps the stamp. Seerr also moves that date for other edits, so
 * it can only err towards announcing, and without both dates the restore is
 * announced: a late notification is noise, a missing one loses the news.
 */
export function restoreKeepsStatusStamp(
  next: DiscoveryRequestStatus,
  failedFrom: string | null,
  failedAt: Date | null,
  seerrChangedAt: Date | null | undefined
): boolean {
  if (next === 'failed' || next === 'available') return false
  if (failedFrom != null) return next === failedFrom
  if (failedAt == null || seerrChangedAt == null) return false
  return seerrChangedAt.getTime() <= failedAt.getTime()
}

/** The row as it stands under the writer's lock. */
export interface HeldRequestRow {
  status: DiscoveryRequestStatus
  statusChangedAt: Date | null
  failedFrom: string | null
}

export type LiveRecordPlan =
  | { write: false; status: DiscoveryRequestStatus }
  | { write: true; next: DiscoveryRequestStatus; restore: boolean; keepStamp: boolean }

/**
 * What to write for one row, given the status the caller READ, the row as it
 * stands now (locked), and Seerr's live answer. Pure, pinned.
 *
 * A row whose status moved since the caller read it is left alone: someone
 * else recorded it (an admin's approve or decline, the job and a list load at
 * once), and a live answer fetched before that is older than their write.
 */
export function planLiveRecord(
  readStatus: DiscoveryRequestStatus,
  held: HeldRequestRow | null,
  live: SeerrLiveRequestStatus
): LiveRecordPlan {
  if (!held) return { write: false, status: readStatus }
  if (held.status !== readStatus) return { write: false, status: held.status }
  const next = resolveRequestStatus(held.status, live)
  if (next === held.status) return { write: false, status: next }
  if (held.status !== 'failed') return { write: true, next, restore: false, keepStamp: false }
  return {
    write: true,
    next,
    restore: true,
    keepStamp: restoreKeepsStatusStamp(next, held.failedFrom, held.statusChangedAt, live.updatedAt),
  }
}

/** What `recordLiveRequestStatus` left on the row. */
export interface RecordedRequestStatus {
  /** The status the row holds now. */
  status: DiscoveryRequestStatus
  /** Whether the row's `status_changed_at` moved (it sorts by it and notifies off it). */
  stamped: boolean
}

/**
 * Bring one row in line with Seerr's live answer, by the sweep's rule. The one
 * writer for a status read from Seerr: the reconcile job, the requests list and
 * the single-request status route all record through it. Every write happens
 * under the row's lock and only over the status the caller read
 * (`planLiveRecord`).
 */
export async function recordLiveRequestStatus(
  row: { id: string; status: DiscoveryRequestStatus },
  live: SeerrLiveRequestStatus
): Promise<RecordedRequestStatus> {
  // Nothing to write by the caller's own reading: no lock taken.
  if (resolveRequestStatus(row.status, live) === row.status) return { status: row.status, stamped: false }
  return transaction(async (client) => {
    const found = await client.query<{
      status: DiscoveryRequestStatus
      status_changed_at: Date | null
      failed_from: string | null
    }>(`SELECT status, status_changed_at, failed_from FROM discovery_requests WHERE id = $1 FOR UPDATE`, [row.id])
    const heldRow = found.rows[0]
    const plan = planLiveRecord(
      row.status,
      heldRow
        ? { status: heldRow.status, statusChangedAt: heldRow.status_changed_at, failedFrom: heldRow.failed_from }
        : null,
      live
    )
    if (!plan.write) return { status: plan.status, stamped: false }
    if (!plan.restore) {
      await client.query(
        `UPDATE discovery_requests
            SET status = $2,
                seerr_unconfirmed_since = CASE WHEN $2 = 'pending' THEN seerr_unconfirmed_since ELSE NULL END
          WHERE id = $1`,
        [row.id, plan.next]
      )
      return { status: plan.next, stamped: true }
    }
    // The failure message described a deletion that did not happen.
    await client.query(
      `UPDATE discovery_requests
          SET status = $2, status_message = NULL, seerr_unconfirmed_since = NULL, failed_from = NULL
        WHERE id = $1`,
      [row.id, plan.next]
    )
    if (plan.keepStamp) {
      // A second write with the status unchanged: the trigger leaves it alone.
      await client.query(`UPDATE discovery_requests SET status_changed_at = $2 WHERE id = $1`, [
        row.id,
        heldRow?.status_changed_at ?? null,
      ])
    }
    return { status: plan.next, stamped: !plan.keepStamp }
  })
}

/**
 * Which slice of the failed-with-a-request rows tonight's pass re-checks:
 * successive nights take successive windows of `limit`, wrapping, so every row
 * comes round within ceil(total / limit) nights and nothing is written to the
 * rows to mark them checked (any write moves `updated_at`). Pure, pinned.
 */
export function recheckWindow(total: number, limit: number, night: number): { offset: number; wrap: number } {
  if (total <= limit || limit <= 0) return { offset: 0, wrap: 0 }
  const windows = Math.ceil(total / limit)
  const offset = (((night % windows) + windows) % windows) * limit
  // The last window may be short; it continues from the start.
  return { offset, wrap: Math.max(0, offset + limit - total) }
}

/** Tonight's window of failed rows that still name a Seerr request. */
async function failedRecheckBatch(): Promise<{ id: string; seerr_request_id: number; status: DiscoveryRequestStatus }[]> {
  const where = `seerr_request_id IS NOT NULL AND status = 'failed'`
  const counted = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM discovery_requests WHERE ${where}`)
  const total = counted.rows[0]?.c ?? 0
  if (total === 0) return []
  const night = Math.floor(Date.now() / 86_400_000)
  const { offset, wrap } = recheckWindow(total, FAILED_RECHECK_LIMIT, night)
  const select = `SELECT id, seerr_request_id, status FROM discovery_requests WHERE ${where} ORDER BY id`
  const main = await query<{ id: string; seerr_request_id: number; status: DiscoveryRequestStatus }>(
    `${select} LIMIT $1 OFFSET $2`,
    [FAILED_RECHECK_LIMIT, offset]
  )
  if (wrap === 0) return main.rows
  const rest = await query<{ id: string; seerr_request_id: number; status: DiscoveryRequestStatus }>(
    `${select} LIMIT $1`,
    [wrap]
  )
  return [...main.rows, ...rest.rows]
}

/**
 * Sweep non-terminal discovery requests and update any whose Seerr state moved.
 */
export async function reconcileDiscoveryRequests(
  shouldCancel?: () => boolean
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    checked: 0,
    updated: 0,
    strandedFailed: 0,
    unconfirmedFound: 0,
    unconfirmedFailed: 0,
    unreachable: 0,
    cancelled: false,
  }

  // Write off submissions that never got a Seerr id. Done as one statement --
  // there is nothing to ask Seerr about, since no request was ever created.
  const stranded = await query(
    `UPDATE discovery_requests
        SET status = 'failed',
            status_message = COALESCE(status_message, 'No Seerr request was created; marked failed so the title can be suggested again')
      WHERE seerr_request_id IS NULL
        AND status IN ('pending', 'submitted')
        AND NOT (status = 'pending' AND seerr_unconfirmed_since IS NOT NULL)
        AND created_at < NOW() - INTERVAL '1 hour' * $1::int`,
    [STRANDED_PENDING_HOURS]
  )
  result.strandedFailed = stranded.rowCount ?? 0

  // Rows Seerr never answered for: look them up rather than guess.
  const unconfirmed = await listUnconfirmedRequests(RECONCILE_BATCH_LIMIT)
  if (unconfirmed.length > 0 && shouldCancel?.() !== true) {
    const settled = await settleUnconfirmedBatch(unconfirmed)
    for (const row of settled.values()) {
      if (row.status === 'submitted') result.unconfirmedFound++
      else if (row.status === 'failed') result.unconfirmedFailed++
    }
  }

  type SweepRow = { id: string; seerr_request_id: number; status: DiscoveryRequestStatus }

  const pending = await query<SweepRow>(
    `SELECT id, seerr_request_id, status
       FROM discovery_requests
      WHERE seerr_request_id IS NOT NULL
        AND status = ANY($1::text[])
      ORDER BY updated_at ASC
      LIMIT $2`,
    [NON_TERMINAL_STATUSES, RECONCILE_BATCH_LIMIT]
  )

  // Rows recorded as failed that still name a Seerr request: only a deletion
  // in Seerr fails such a row now, but an unanswered lookup used to as well, and
  // those requests carried on in Seerr. Checked in their own small batch, a
  // different window each night (`recheckWindow`), so they never crowd out the
  // live ones and nothing is written to the rows that are still deleted.
  const failedWithRequest = await failedRecheckBatch()

  // A 404 is written down only after Seerr is seen answering at its address.
  const notFound: SweepRow[] = []

  for (const row of [...pending.rows, ...failedWithRequest]) {
    if (shouldCancel?.() === true) {
      result.cancelled = true
      break
    }

    result.checked++

    const lookup = await lookupRequestStatus(row.seerr_request_id)

    if (lookup.kind === 'failed') {
      // A Seerr outage must not rewrite anyone's request history. Leave the row
      // exactly as it is and try again next run.
      logger.debug({ requestId: row.id }, 'Could not reach Seerr for request')
      result.unreachable++
      continue
    }

    if (lookup.kind === 'not_found') {
      notFound.push(row)
      continue
    }

    try {
      const recorded = await recordLiveRequestStatus(row, lookup.live)
      if (recorded.status !== row.status) result.updated++
    } catch (err) {
      logger.warn({ err, requestId: row.id }, 'Could not record a request status read from Seerr')
    }
  }

  if (notFound.length > 0) {
    if (!(await seerrAnswersAtAddress())) {
      // Every 404 may be the address, not the requests: a wrong base path, or
      // a proxy answering for Seerr. Nothing is written until Seerr answers.
      logger.warn({ count: notFound.length }, 'Seerr answered 404 but not at its own address; no request marked deleted')
      result.unreachable += notFound.length
    } else {
      for (const row of notFound) {
        // Already recorded as deleted: nothing to write.
        if (row.status === 'failed') continue
        // Seerr answered that it has no such request any more -- deleted there.
        // That is terminal from our side, and leaving it non-terminal would
        // suppress the title forever. Only a 404 says this; no answer says nothing.
        // The status it held is kept, so a restore can tell a correction from news.
        const marked = await query(
          `UPDATE discovery_requests
              SET status = 'failed',
                  failed_from = status,
                  status_message = 'Request no longer exists in Seerr',
                  seerr_unconfirmed_since = NULL
            WHERE id = $1 AND status = $2`,
          [row.id, row.status]
        )
        if ((marked.rowCount ?? 0) > 0) result.updated++
      }
    }
  }

  logger.info(result, 'Reconciled discovery requests')
  return result
}
