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
import { query } from '../lib/db.js'
import { getRequestStatus } from '../seerr/index.js'
import { updateDiscoveryRequestStatus } from './storage.js'
import type { DiscoveryRequestStatus } from './types.js'

const logger = createChildLogger('discover:reconcile')

/**
 * Statuses that can still change. 'declined', 'failed' and 'available' are
 * end states -- Seerr will not move them again, so re-checking them would spend
 * a request per row per run for nothing.
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
 */
const STRANDED_PENDING_HOURS = 24

/** Requests reconciled in one pass, so a large backlog cannot stall the job. */
const RECONCILE_BATCH_LIMIT = 500

export interface ReconcileResult {
  checked: number
  updated: number
  strandedFailed: number
  unreachable: number
  cancelled: boolean
}

/**
 * Map a live Seerr response onto our status vocabulary.
 *
 * Media availability wins over request state: an 'approved' request whose media
 * has finished importing is 'available', and that is the more useful fact. Kept
 * pure and exported so the precedence is testable without a Seerr instance.
 */
export function resolveRequestStatus(
  current: DiscoveryRequestStatus,
  live: { status: 'pending' | 'approved' | 'declined'; mediaStatus: string }
): DiscoveryRequestStatus {
  if (live.mediaStatus === 'available') return 'available'
  if (live.status === 'declined') return 'declined'
  if (live.status === 'approved') return 'approved'
  // Seerr still says pending. Don't walk a request backwards from whatever we
  // already recorded -- 'submitted' is our own word for the same state.
  return current === 'pending' ? 'submitted' : current
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
        AND created_at < NOW() - INTERVAL '1 hour' * $1::int`,
    [STRANDED_PENDING_HOURS]
  )
  result.strandedFailed = stranded.rowCount ?? 0

  const pending = await query<{
    id: string
    seerr_request_id: number
    status: DiscoveryRequestStatus
  }>(
    `SELECT id, seerr_request_id, status
       FROM discovery_requests
      WHERE seerr_request_id IS NOT NULL
        AND status = ANY($1::text[])
      ORDER BY updated_at ASC
      LIMIT $2`,
    [NON_TERMINAL_STATUSES, RECONCILE_BATCH_LIMIT]
  )

  for (const row of pending.rows) {
    if (shouldCancel?.() === true) {
      result.cancelled = true
      break
    }

    result.checked++

    let live: Awaited<ReturnType<typeof getRequestStatus>>
    try {
      live = await getRequestStatus(row.seerr_request_id)
    } catch (err) {
      // A Seerr outage must not rewrite anyone's request history. Leave the row
      // exactly as it is and try again next run.
      logger.debug({ err, requestId: row.id }, 'Could not reach Seerr for request')
      result.unreachable++
      continue
    }

    if (!live) {
      // Seerr has no such request any more -- deleted there, most likely. That
      // is terminal from our side, and leaving it non-terminal would suppress
      // the title forever.
      await updateDiscoveryRequestStatus(row.id, 'failed', {
        statusMessage: 'Request no longer exists in Seerr',
      })
      result.updated++
      continue
    }

    const next = resolveRequestStatus(row.status, live)
    if (next !== row.status) {
      await updateDiscoveryRequestStatus(row.id, next)
      result.updated++
    }
  }

  logger.info(result, 'Reconciled discovery requests')
  return result
}
