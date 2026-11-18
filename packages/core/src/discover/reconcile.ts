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
import { updateDiscoveryRequestStatus } from './storage.js'
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
 * the trigger moves it on every status change. On a failed row the stamp is
 * when it was failed. A decision Seerr made BEFORE that was announced when it
 * happened, so restoring it is a correction and keeps the stamp: no second
 * "approved" weeks later. A decision Seerr made AFTER it (an approval given
 * while the row read as failed) was never announced, so the restore stamps it
 * and it is announced now. Without both dates the restore is announced: a late
 * notification is noise, a missing one loses the news. Arrival always counts
 * as news: a failed row was never available.
 */
export function repairKeepsStatusStamp(
  current: DiscoveryRequestStatus,
  next: DiscoveryRequestStatus,
  failedAt: Date | null,
  seerrChangedAt: Date | null | undefined
): boolean {
  if (current !== 'failed' || next === 'failed' || next === 'available') return false
  if (failedAt == null || seerrChangedAt == null) return false
  return seerrChangedAt.getTime() <= failedAt.getTime()
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
 * the single-request status route all record through it.
 */
export async function recordLiveRequestStatus(
  row: { id: string; status: DiscoveryRequestStatus },
  live: SeerrLiveRequestStatus
): Promise<RecordedRequestStatus> {
  const next = resolveRequestStatus(row.status, live)
  if (next === row.status) return { status: next, stamped: false }
  if (row.status !== 'failed') {
    await updateDiscoveryRequestStatus(row.id, next)
    return { status: next, stamped: true }
  }
  return transaction(async (client) => {
    const before = await client.query<{ status: DiscoveryRequestStatus; status_changed_at: Date | null }>(
      `SELECT status, status_changed_at FROM discovery_requests WHERE id = $1 FOR UPDATE`,
      [row.id]
    )
    const held = before.rows[0]
    if (!held) return { status: row.status, stamped: false }
    if (held.status !== 'failed') {
      // Someone recorded it since it was read (the job and a list load at
      // once): theirs stands, and is what the row holds.
      return { status: held.status, stamped: false }
    }
    const keepStamp = repairKeepsStatusStamp('failed', next, held.status_changed_at, live.updatedAt)
    // The failure message described a deletion that did not happen.
    await client.query(
      `UPDATE discovery_requests
          SET status = $2, status_message = NULL, seerr_unconfirmed_since = NULL
        WHERE id = $1`,
      [row.id, next]
    )
    if (keepStamp) {
      // A second write with the status unchanged: the trigger leaves it alone.
      await client.query(`UPDATE discovery_requests SET status_changed_at = $2 WHERE id = $1`, [
        row.id,
        held.status_changed_at,
      ])
    }
    return { status: next, stamped: !keepStamp }
  })
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
  // those requests carried on in Seerr. Checked in their own small batch,
  // longest unchecked first, so they never crowd out the live ones.
  const failedWithRequest = await query<SweepRow>(
    `SELECT id, seerr_request_id, status
       FROM discovery_requests
      WHERE seerr_request_id IS NOT NULL
        AND status = 'failed'
      ORDER BY updated_at ASC
      LIMIT $1`,
    [FAILED_RECHECK_LIMIT]
  )

  // A 404 is written down only after Seerr is seen answering at its address.
  const notFound: SweepRow[] = []

  for (const row of [...pending.rows, ...failedWithRequest.rows]) {
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
        if (row.status === 'failed') {
          // Already recorded as deleted. Moving updated_at sends it to the back
          // of the failed batch, so the rest get their turn.
          await query(`UPDATE discovery_requests SET updated_at = NOW() WHERE id = $1`, [row.id])
          continue
        }
        // Seerr answered that it has no such request any more -- deleted there.
        // That is terminal from our side, and leaving it non-terminal would
        // suppress the title forever. Only a 404 says this; no answer says nothing.
        await updateDiscoveryRequestStatus(row.id, 'failed', {
          statusMessage: 'Request no longer exists in Seerr',
        })
        result.updated++
      }
    }
  }

  logger.info(result, 'Reconciled discovery requests')
  return result
}
