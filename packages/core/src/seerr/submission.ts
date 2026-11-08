/**
 * Sending a request to Seerr, and settling one whose answer was lost.
 *
 * Every route that records a request in `discovery_requests` and sends it to
 * Seerr (`POST /api/seerr/request`, gap analysis) goes through here:
 *
 * 1. `withSeerrRequestLock` lets one request for a title be checked and sent at a
 *    time, so a double click, a second tab or two people at once cannot both pass
 *    the "already requested?" check before either row exists. In-process, because
 *    the API is one process; nothing waits, a second caller is told it is busy.
 * 2. `settleUnconfirmedRequestsFor` decides any earlier request of this person's
 *    for the title that Seerr never answered, before the duplicate checks read it.
 * 3. `recordSeerrAnswer` writes what Seerr said. A lost answer is looked up at
 *    once; if Seerr does not list the request yet, the row stays pending and
 *    unconfirmed. The reconcile job settles it (`settleUnconfirmedBatch`), and so
 *    does the requests list, within a short budget (`settleListedRequests`).
 *
 * Settling outside a send takes the title's lock too, so it can never match a
 * request that a send for the same title is creating at that moment.
 *
 * The rules are pure in `submissionRules.ts`.
 */
import { concurrencyLimit } from '../lib/asyncCache.js'
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { updateDiscoveryRequestStatus } from '../discover/storage.js'
import type { DiscoveryRequest, MediaType } from '../discover/types.js'
import { getTitleRequests } from './provider.js'
import { decideTitleRows, type UnconfirmedOutcome } from './submissionRules.js'

const logger = createChildLogger('seerr-submission')

const sending = new Set<string>()

/**
 * Titles looked up in Seerr at once when settling outside a send. Process-wide,
 * so a reconcile run over hundreds of rows and a requests-list read share it.
 */
const SETTLE_CONCURRENCY = 4
const settleSlot = concurrencyLimit(SETTLE_CONCURRENCY)

function lockKey(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`
}

/** True while a request for this title is being checked, sent or settled. */
export function isSeerrRequestInFlight(mediaType: MediaType, tmdbId: number): boolean {
  return sending.has(lockKey(mediaType, tmdbId))
}

/**
 * Run `fn` holding this title's request lock, or answer `{ busy: true }` at once
 * when another request for it is already being checked, sent or settled.
 */
export async function withSeerrRequestLock<T>(
  mediaType: MediaType,
  tmdbId: number,
  fn: () => Promise<T>
): Promise<{ busy: true } | { busy: false; value: T }> {
  const key = lockKey(mediaType, tmdbId)
  if (sending.has(key)) return { busy: true }
  sending.add(key)
  try {
    return { busy: false, value: await fn() }
  } finally {
    sending.delete(key)
  }
}

/** The Aperture row a lost answer left, as much of it as settling needs. */
export interface UnconfirmedRow {
  id: string
  mediaType: MediaType
  tmdbId: number
  seasons?: number[] | null
  unconfirmedSince: Date
  /** The Seerr user it was sent as; null = the API key's own user, unknown here. */
  requestedAs: number | null
}

/** What settling recorded on a row; `status` absent = left as it was. */
export interface SettledRow {
  outcome: UnconfirmedOutcome
  status?: 'submitted' | 'failed'
  statusMessage?: string
  seerrRequestId?: number
}

const CONFIRMED_MESSAGE = 'Confirmed in Seerr'
const ABSENT_MESSAGE = 'Seerr has no record of this request'

/**
 * Settle unanswered rows of ONE title from one read of Seerr (`decideTitleRows`)
 * and write what was decided. The caller holds the title's lock. Never throws.
 */
async function settleTitle(
  rows: readonly UnconfirmedRow[],
  options: { final: boolean; now?: Date }
): Promise<Map<string, SettledRow>> {
  const settled = new Map<string, SettledRow>()
  const first = rows[0]
  if (!first) return settled
  try {
    const [requests, recorded] = await Promise.all([
      getTitleRequests(first.tmdbId, first.mediaType === 'movie' ? 'movie' : 'tv'),
      query<{ seerr_request_id: number }>(
        `SELECT seerr_request_id FROM discovery_requests
         WHERE media_type = $1 AND tmdb_id = $2 AND seerr_request_id IS NOT NULL
           AND NOT (id = ANY($3::uuid[]))`,
        [first.mediaType, first.tmdbId, rows.map((row) => row.id)]
      ),
    ])
    const decided = decideTitleRows(
      rows.map((row) => ({
        id: row.id,
        since: row.unconfirmedSince,
        requesterSeerrId: row.requestedAs,
        seasons: row.seasons ?? null,
      })),
      requests,
      new Set(recorded.rows.map((r) => Number(r.seerr_request_id))),
      { now: options.now ?? new Date(), final: options.final }
    )

    for (const row of decided) {
      if (row.outcome === 'confirmed' && row.seerrRequestId != null) {
        await updateDiscoveryRequestStatus(row.id, 'submitted', {
          seerrRequestId: row.seerrRequestId,
          statusMessage: CONFIRMED_MESSAGE,
        })
        logger.info({ requestId: row.id, seerrRequestId: row.seerrRequestId }, 'Unanswered Seerr request found in Seerr')
        settled.set(row.id, {
          outcome: row.outcome,
          status: 'submitted',
          statusMessage: CONFIRMED_MESSAGE,
          seerrRequestId: row.seerrRequestId,
        })
      } else if (row.outcome === 'absent') {
        await updateDiscoveryRequestStatus(row.id, 'failed', { statusMessage: ABSENT_MESSAGE })
        logger.info({ requestId: row.id }, 'Unanswered Seerr request is not in Seerr')
        settled.set(row.id, { outcome: row.outcome, status: 'failed', statusMessage: ABSENT_MESSAGE })
      } else {
        settled.set(row.id, { outcome: row.outcome })
      }
    }
  } catch (err) {
    logger.warn({ err, tmdbId: first.tmdbId }, 'Could not settle unanswered Seerr requests')
    for (const row of rows) if (!settled.has(row.id)) settled.set(row.id, { outcome: 'waiting' })
  }
  return settled
}

interface UnconfirmedSqlRow {
  id: string
  media_type: MediaType
  tmdb_id: number
  seasons: number[] | null
  seerr_unconfirmed_since: Date
  seerr_requested_as: number | null
}

const UNCONFIRMED_COLUMNS = `id, media_type, tmdb_id, seasons, seerr_unconfirmed_since, seerr_requested_as`

function fromSql(row: UnconfirmedSqlRow): UnconfirmedRow {
  return {
    id: row.id,
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    seasons: row.seasons,
    unconfirmedSince: row.seerr_unconfirmed_since,
    requestedAs: row.seerr_requested_as != null ? Number(row.seerr_requested_as) : null,
  }
}

/**
 * Settle this person's unanswered requests for a title before they ask for it
 * again (`final`: Seerr not listing one means it was not made). The caller holds
 * the title's lock. Answers whether one is still undecided because Seerr could
 * not be read; the caller then refuses rather than risk a second request.
 */
export async function settleUnconfirmedRequestsFor(
  userId: string,
  mediaType: MediaType,
  tmdbId: number
): Promise<{ stillWaiting: boolean }> {
  const rows = await query<UnconfirmedSqlRow>(
    `SELECT ${UNCONFIRMED_COLUMNS} FROM discovery_requests
     WHERE user_id = $1 AND media_type = $2 AND tmdb_id = $3
       AND status = 'pending' AND seerr_unconfirmed_since IS NOT NULL`,
    [userId, mediaType, tmdbId]
  )
  if (rows.rows.length === 0) return { stillWaiting: false }
  const settled = await settleTitle(rows.rows.map(fromSql), { final: true })
  return { stillWaiting: [...settled.values()].some((row) => row.outcome === 'waiting') }
}

/**
 * Settle unanswered rows of any titles, each title under its lock (a title being
 * sent right now is skipped and left for next time), `SETTLE_CONCURRENCY`
 * titles at a time. With
 * `budgetMs`, answers once that has passed with whatever was settled by then; the
 * rest still finish and write their rows.
 */
export async function settleUnconfirmedBatch(
  rows: readonly UnconfirmedRow[],
  options: { budgetMs?: number } = {}
): Promise<Map<string, SettledRow>> {
  const byTitle = new Map<string, UnconfirmedRow[]>()
  for (const row of rows) {
    const key = lockKey(row.mediaType, row.tmdbId)
    const list = byTitle.get(key)
    if (list) list.push(row)
    else byTitle.set(key, [row])
  }

  const settled = new Map<string, SettledRow>()
  const work = Promise.all(
    [...byTitle.values()].map(async (titleRows) => {
      const first = titleRows[0] as UnconfirmedRow
      const locked = await settleSlot(() =>
        withSeerrRequestLock(first.mediaType, first.tmdbId, () => settleTitle(titleRows, { final: false }))
      )
      if (locked.busy) return
      for (const [id, row] of locked.value) settled.set(id, row)
    })
  ).catch((err: unknown) => {
    // Nothing awaits it past the budget, so it must not reject unhandled.
    logger.warn({ err }, 'Settling unanswered Seerr requests failed')
  })

  if (options.budgetMs == null) {
    await work
  } else {
    let timer: NodeJS.Timeout | undefined
    await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, options.budgetMs) })])
    if (timer) clearTimeout(timer)
  }
  return new Map(settled)
}

/** Unanswered rows, oldest first, for the reconcile job. */
export async function listUnconfirmedRequests(limit: number): Promise<UnconfirmedRow[]> {
  const rows = await query<UnconfirmedSqlRow>(
    `SELECT ${UNCONFIRMED_COLUMNS} FROM discovery_requests
     WHERE status = 'pending' AND seerr_unconfirmed_since IS NOT NULL
     ORDER BY seerr_unconfirmed_since ASC
     LIMIT $1`,
    [limit]
  )
  return rows.rows.map(fromSql)
}

/** What a send came to, for the route to answer with. */
export type SeerrSubmission =
  | { kind: 'submitted'; seerrRequestId: number }
  | { kind: 'refused'; message: string; status: number | null }
  | { kind: 'unconfirmed'; message: string }

export const UNCONFIRMED_REQUEST_MESSAGE =
  'Seerr did not confirm the request, so it is not known yet whether it was made. ' +
  'It shows as waiting for Seerr in My Requests and is checked again; ask again only if it fails.'

/**
 * Record Seerr's answer on the row created for this send. `sentAt` is taken just
 * before the row was inserted, so a lost answer is matched from then;
 * `requestedAs` is the Seerr user the final attempt went as (null = the API key's
 * own user), so the match looks for the right requester.
 */
export async function recordSeerrAnswer(
  apertureRequestId: string,
  result: { success: boolean; requestId?: number; message?: string; status?: number | null; uncertain: boolean },
  context: {
    mediaType: MediaType
    tmdbId: number
    seasons?: number[] | null
    sentAt: Date
    requestedAs: number | null
  }
): Promise<SeerrSubmission> {
  if (result.success && result.requestId != null) {
    await updateDiscoveryRequestStatus(apertureRequestId, 'submitted', { seerrRequestId: result.requestId })
    return { kind: 'submitted', seerrRequestId: result.requestId }
  }
  if (!result.uncertain) {
    const message = result.message ?? 'Seerr refused the request'
    await updateDiscoveryRequestStatus(apertureRequestId, 'failed', { statusMessage: message })
    return { kind: 'refused', message, status: result.status ?? null }
  }

  // Seerr's own words when it answered at all (a 5xx), kept on the row and in
  // the reply: they may be the explanation, even though they don't settle it.
  const seerrSaid = result.status != null && result.status >= 500 && result.message ? result.message : null
  await query(
    `UPDATE discovery_requests
        SET seerr_requested_as = $2, status_message = COALESCE($3, status_message)
      WHERE id = $1 AND status = 'pending'`,
    [apertureRequestId, context.requestedAs, seerrSaid]
  )

  const settled = await settleTitle(
    [
      {
        id: apertureRequestId,
        mediaType: context.mediaType,
        tmdbId: context.tmdbId,
        seasons: context.seasons ?? null,
        unconfirmedSince: context.sentAt,
        requestedAs: context.requestedAs,
      },
    ],
    { final: false }
  )
  const row = settled.get(apertureRequestId)
  if (row?.status === 'submitted' && row.seerrRequestId != null) {
    return { kind: 'submitted', seerrRequestId: row.seerrRequestId }
  }
  logger.warn({ apertureRequestId, status: result.status }, 'Seerr did not answer a request; left unconfirmed')
  return {
    kind: 'unconfirmed',
    message: seerrSaid ? `${UNCONFIRMED_REQUEST_MESSAGE} Seerr answered: ${seerrSaid}` : UNCONFIRMED_REQUEST_MESSAGE,
  }
}

/** At most this many unanswered rows are looked up per requests-list read. */
export const SETTLE_PER_LIST = 5

/** How long a requests-list read waits for those lookups before answering. */
export const LIST_SETTLE_BUDGET_MS = 2_500

/**
 * Settle the unanswered rows of a requests list, within `LIST_SETTLE_BUDGET_MS`,
 * and return the rows with what was recorded. A row not settled in time is shown
 * as it was; its lookup still finishes and writes.
 */
export async function settleListedRequests(rows: DiscoveryRequest[]): Promise<DiscoveryRequest[]> {
  const due: UnconfirmedRow[] = rows
    .filter((row) => row.status === 'pending' && row.unconfirmedSince != null)
    .slice(0, SETTLE_PER_LIST)
    .map((row) => ({
      id: row.id,
      mediaType: row.mediaType,
      tmdbId: row.tmdbId,
      seasons: row.seasons ?? null,
      unconfirmedSince: row.unconfirmedSince as Date,
      requestedAs: row.seerrRequestedAs ?? null,
    }))
  if (due.length === 0) return rows

  const settled = await settleUnconfirmedBatch(due, { budgetMs: LIST_SETTLE_BUDGET_MS })
  return rows.map((row) => {
    const result = settled.get(row.id)
    if (!result?.status) return row
    return {
      ...row,
      status: result.status,
      statusMessage: result.statusMessage ?? row.statusMessage,
      seerrRequestId: result.seerrRequestId ?? row.seerrRequestId,
      unconfirmedSince: null,
    }
  })
}
