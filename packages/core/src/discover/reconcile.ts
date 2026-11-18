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
import { getSystemSettingRaw, setSystemSetting } from '../settings/systemSettings.js'
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

/** The live sweep: every request that can still change and names a Seerr request. */
const LIVE_SWEEP_WHERE = `seerr_request_id IS NOT NULL AND status IN (${NON_TERMINAL_STATUSES.map((s) => `'${s}'`).join(', ')})`

/** The re-check of failed rows that still name a Seerr request. */
const FAILED_SWEEP_WHERE = `seerr_request_id IS NOT NULL AND status = 'failed'`

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
 * puts back the date its status was reached instead of stamping now.
 *
 * Request notifications fire off `status_changed_at` (core
 * notifications/events.ts), and the trigger moves it on every status change. A
 * row failed on a Seerr 404 records the status it held (`failed_from`, 0225)
 * and when it reached it (`failed_from_changed_at`): coming back to that same
 * status is a correction, already announced when it first happened, so it gets
 * that date back -- long past every notification window. Coming back to a
 * different one is a decision made since, never announced, so it is announced
 * now. Arrival always counts as news: a failed row was never available.
 *
 * A row failed before 0225 has no `failed_from`. For those, Seerr's own last
 * change to the request stands in: at or before the failure (the stamp of a
 * failed row) keeps the failure's date. Seerr also moves that date for other
 * edits, so it can only err towards announcing, and without both dates the
 * restore is announced: a late notification is noise, a missing one loses the
 * news.
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
  /** When `failedFrom` was reached (0225); null on rows failed before it. */
  failedFromChangedAt: Date | null
}

export type LiveRecordPlan =
  | { write: false; status: DiscoveryRequestStatus }
  | {
      write: true
      next: DiscoveryRequestStatus
      restore: boolean
      /** Present when a restore puts a date back: the one to write. */
      keepStampAt?: Date | null
    }

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
  if (held.status !== 'failed') return { write: true, next, restore: false }
  if (!restoreKeepsStatusStamp(next, held.failedFrom, held.statusChangedAt, live.updatedAt)) {
    return { write: true, next, restore: true }
  }
  // The date `failed_from` was reached; a row failed before 0225 keeps the
  // failure's own date, as it did then.
  const keepStampAt = held.failedFrom != null ? held.failedFromChangedAt : held.statusChangedAt
  return { write: true, next, restore: true, keepStampAt }
}

/** What `recordLiveRequestStatus` left on the row. */
export interface RecordedRequestStatus {
  /**
   * The status the row holds now. When it differs from the one the caller
   * read, so does `status_changed_at` (the trigger, or a restore putting a date
   * back), whoever wrote it.
   */
  status: DiscoveryRequestStatus
  /** Whether this call wrote it (false: unchanged, or someone else got there first). */
  wrote: boolean
}

/** Puts a restored row's date back. A second write with the status unchanged, so the 0215 trigger leaves it. */
export const RESTORE_STATUS_DATE_SQL = `UPDATE discovery_requests SET status_changed_at = $2 WHERE id = $1`

/**
 * Restores a row failed on a 404 that Seerr still holds. The failure message
 * described a deletion that did not happen; `failed_from` and
 * `failed_from_changed_at` are cleared by 0225's trigger as the row leaves
 * failed.
 */
export const RESTORE_FAILED_ROW_SQL = `UPDATE discovery_requests
          SET status = $2, status_message = NULL, seerr_unconfirmed_since = NULL
        WHERE id = $1`

/**
 * Marks a row failed because Seerr answered that the request no longer exists,
 * only while it still holds the status the sweep read. In a SET list a column
 * reads the row as it was, so `failed_from` gets the status it held and
 * `failed_from_changed_at` the date it reached it, before the trigger stamps
 * the failure.
 */
export const MARK_DELETED_IN_SEERR_SQL = `UPDATE discovery_requests
              SET status = 'failed',
                  failed_from = status,
                  failed_from_changed_at = status_changed_at,
                  status_message = 'Request no longer exists in Seerr',
                  seerr_unconfirmed_since = NULL
            WHERE id = $1 AND status = $2`

interface HeldRowRecord {
  status: DiscoveryRequestStatus
  status_changed_at: Date | null
  failed_from: string | null
  failed_from_changed_at: Date | null
}

/**
 * `recordLiveRequestStatus` on a connection inside the caller's transaction.
 * Exported so the statements it runs can be pinned on a recorded connection.
 */
export async function applyLiveRecord(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> },
  row: { id: string; status: DiscoveryRequestStatus },
  live: SeerrLiveRequestStatus
): Promise<RecordedRequestStatus> {
  const found = await client.query(
    `SELECT status, status_changed_at, failed_from, failed_from_changed_at
       FROM discovery_requests WHERE id = $1 FOR UPDATE`,
    [row.id]
  )
  const held = found.rows[0] as HeldRowRecord | undefined
  const plan = planLiveRecord(
    row.status,
    held
      ? {
          status: held.status,
          statusChangedAt: held.status_changed_at,
          failedFrom: held.failed_from,
          failedFromChangedAt: held.failed_from_changed_at,
        }
      : null,
    live
  )
  if (!plan.write) return { status: plan.status, wrote: false }
  if (!plan.restore) {
    await updateDiscoveryRequestStatus(row.id, plan.next, {}, client)
    return { status: plan.next, wrote: true }
  }
  await client.query(RESTORE_FAILED_ROW_SQL, [row.id, plan.next])
  if (plan.keepStampAt !== undefined) await client.query(RESTORE_STATUS_DATE_SQL, [row.id, plan.keepStampAt])
  logger.info({ requestId: row.id, status: plan.next, dateKept: plan.keepStampAt !== undefined }, 'Restored a request Seerr still holds')
  return { status: plan.next, wrote: true }
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
  if (resolveRequestStatus(row.status, live) === row.status) return { status: row.status, wrote: false }
  return transaction((client) => applyLiveRecord(client, row, live))
}

/** Where each sweep stopped, so the next pass carries on after it. */
const SWEEP_CURSORS_KEY = 'discovery_reconcile_cursors'

export type SweepName = 'live' | 'failed'
export type SweepCursors = Partial<Record<SweepName, string>>

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The stored cursors; anything not a row id is dropped (start from the beginning). Pure, pinned. */
export function parseSweepCursors(raw: string | null): SweepCursors {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: SweepCursors = {}
    for (const name of ['live', 'failed'] as const) {
      const value = (parsed as Record<string, unknown>)[name]
      if (typeof value === 'string' && UUID_SHAPE.test(value)) out[name] = value
    }
    return out
  } catch {
    return {}
  }
}

/**
 * The two statements of a keyed batch: rows after the cursor in id order, then,
 * if that is short, rows from the start up to the cursor. Every row comes round
 * in turn however many join or leave in between (an offset would shift), and
 * nothing is written to a row to mark it checked (any write moves
 * `updated_at`). `$1` is the cursor, `$2` the limit. Pure, pinned.
 */
export function keyedBatchSql(where: string): { after: string; wrap: string } {
  const select = `SELECT id, seerr_request_id, status FROM discovery_requests WHERE ${where}`
  return {
    after: `${select} AND ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`,
    wrap: `${select} AND id <= $1::uuid ORDER BY id LIMIT $2`,
  }
}

/**
 * The next cursor: the last of the batch's rows, in the order they were read,
 * before the first one Seerr gave no answer for (an outage, or a cancelled
 * pass that never reached it). That row and the rest are read again next time
 * rather than skipped for a whole round. Pure, pinned.
 */
export function cursorAfter(
  batch: readonly { id: string }[],
  answered: ReadonlySet<string>,
  previous: string | undefined
): string | undefined {
  let cursor = previous
  for (const row of batch) {
    if (!answered.has(row.id)) break
    cursor = row.id
  }
  return cursor
}

type SweepRow = { id: string; seerr_request_id: number; status: DiscoveryRequestStatus }

async function keyedBatch(where: string, limit: number, after: string | undefined): Promise<SweepRow[]> {
  const sql = keyedBatchSql(where)
  const first = await query<SweepRow>(sql.after, [after ?? null, limit])
  if (first.rows.length >= limit || after === undefined) return first.rows
  const rest = await query<SweepRow>(sql.wrap, [after, limit - first.rows.length])
  return [...first.rows, ...rest.rows]
}

async function readSweepCursors(): Promise<SweepCursors> {
  try {
    return parseSweepCursors(await getSystemSettingRaw(SWEEP_CURSORS_KEY))
  } catch (err) {
    logger.warn({ err }, 'Could not read where the last reconcile stopped; starting from the beginning')
    return {}
  }
}

async function saveSweepCursors(cursors: SweepCursors): Promise<void> {
  try {
    await setSystemSetting(SWEEP_CURSORS_KEY, JSON.stringify(cursors), 'Where the nightly request reconcile stopped')
  } catch (err) {
    logger.warn({ err }, 'Could not record where the reconcile stopped')
  }
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

  // Each sweep carries on where the last pass stopped (`keyedBatch`), so a
  // backlog larger than one batch comes round in turn: ordering by when a row
  // last changed would check the same unchanged rows every night.
  const cursors = await readSweepCursors()
  const live = await keyedBatch(LIVE_SWEEP_WHERE, RECONCILE_BATCH_LIMIT, cursors.live)

  // Rows recorded as failed that still name a Seerr request: only a deletion
  // in Seerr fails such a row now, but an unanswered lookup used to as well, and
  // those requests carried on in Seerr. Checked in their own small batch, so
  // they never crowd out the live ones, and nothing is written to the rows that
  // are still deleted.
  const failedWithRequest = await keyedBatch(FAILED_SWEEP_WHERE, FAILED_RECHECK_LIMIT, cursors.failed)

  const sweeps: { name: SweepName; rows: SweepRow[] }[] = [
    { name: 'live', rows: live },
    { name: 'failed', rows: failedWithRequest },
  ]
  // Rows Seerr gave an answer for: the cursors move past those only.
  const answered = new Set<string>()
  // A 404 is written down only after Seerr is seen answering at its address.
  const notFound: SweepRow[] = []

  sweep: for (const { rows } of sweeps) {
    for (const row of rows) {
      if (shouldCancel?.() === true) {
        result.cancelled = true
        break sweep
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

      answered.add(row.id)
      try {
        const recorded = await recordLiveRequestStatus(row, lookup.live)
        if (recorded.wrote) result.updated++
      } catch (err) {
        logger.warn({ err, requestId: row.id }, 'Could not record a request status read from Seerr')
      }
    }
  }

  let seerrAtAddress = true
  if (notFound.length > 0) {
    seerrAtAddress = await seerrAnswersAtAddress()
    if (!seerrAtAddress) {
      // Every 404 may be the address, not the requests: a wrong base path, or
      // a proxy answering for Seerr. Nothing is written until Seerr answers.
      logger.warn({ count: notFound.length }, 'Seerr answered 404 but not at its own address; no request marked deleted')
      result.unreachable += notFound.length
    } else {
      for (const row of notFound) {
        answered.add(row.id)
        // Already recorded as deleted: nothing to write.
        if (row.status === 'failed') continue
        // Seerr answered that it has no such request any more -- deleted there.
        // That is terminal from our side, and leaving it non-terminal would
        // suppress the title forever. Only a 404 says this; no answer says nothing.
        // The status it held is kept, so a restore can tell a correction from news.
        const marked = await query(MARK_DELETED_IN_SEERR_SQL, [row.id, row.status])
        if ((marked.rowCount ?? 0) > 0) result.updated++
      }
    }
  }

  // The rows were visited in id order, so the last one answered is where each
  // sweep stopped. While Seerr is not answering at its address nothing moves.
  if (seerrAtAddress) {
    const next: SweepCursors = {}
    for (const { name, rows } of sweeps) {
      const cursor = cursorAfter(rows, answered, cursors[name])
      if (cursor !== undefined) next[name] = cursor
    }
    if (next.live !== cursors.live || next.failed !== cursors.failed) await saveSweepCursors(next)
  }

  logger.info(result, 'Reconciled discovery requests')
  return result
}
