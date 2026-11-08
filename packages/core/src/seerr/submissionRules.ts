/**
 * What a request sent to Seerr became, when Seerr's answer did not say.
 *
 * Pure, no imports with side effects (pinned by `submissionRules.test.ts`).
 *
 * A POST to Seerr can end without an answer that tells us anything: the call
 * timed out, the connection dropped, the body did not parse, or Seerr answered
 * 5xx after it may already have committed the request. Recording any of those
 * as "failed" is wrong both ways: the request may exist, and the person is
 * invited to ask again and make a second one. So a lost answer leaves the row
 * pending, and the title's own requests in Seerr are read to find out.
 */

/** A POST /request gives up after this long; it never waited at all before. */
export const SEERR_CREATE_TIMEOUT_MS = 15_000

/** Reading a title's requests back, to see whether ours is among them. */
export const SEERR_CONFIRM_TIMEOUT_MS = 5_000

/**
 * How far before our send a Seerr request may be dated and still be ours. Covers
 * clocks that differ between the two servers; a request this user made in Seerr
 * itself just before would have made Seerr refuse ours as a duplicate (an answer,
 * not a lost one), so the window does not swallow someone else's request.
 */
export const CONFIRM_CLOCK_SLACK_MS = 2 * 60_000

/**
 * A request still missing from Seerr this long after it was sent was never made.
 * Seerr creates a request inside the POST, so ten minutes is far past any answer
 * still on its way; before that, a missing request only means "not yet known".
 */
export const UNCONFIRMED_GIVE_UP_MS = 10 * 60_000

/**
 * Whether a failed POST /request may still have made the request. No status means
 * no answer (timeout, dropped connection, unreadable body); a 5xx can come after
 * the write. A 4xx is Seerr refusing, which is an answer.
 */
export function isUncertainCreateFailure(status: number | null | undefined): boolean {
  return status == null || status >= 500
}

/** The parts of one of Seerr's requests for a title that say whose and what it was. */
export interface SeerrRequestTrace {
  id: number
  createdAt: string
  requestedById: number | null
  is4k: boolean
  /** TV only; null for a movie or when Seerr did not list them. */
  seasons: number[] | null
}

/**
 * The Seerr request a lost answer made, or null.
 *
 * Ours is one dated from our send (less clock slack), not already recorded on
 * another Aperture row, made by the Seerr user we sent it as when we know them
 * (`requesterSeerrId` is the identity recorded at send time, never the account's
 * link read later, which may have changed),
 * of the same quality when we know it, and for TV covering a season we asked for.
 * When several fit, the earliest: it is the one closest to our send.
 */
export function findSubmittedRequest(
  requests: readonly SeerrRequestTrace[],
  query: {
    since: Date
    requesterSeerrId: number | null
    seasons: readonly number[] | null
    is4k?: boolean
    recordedIds: ReadonlySet<number>
  }
): SeerrRequestTrace | null {
  const earliest = query.since.getTime() - CONFIRM_CLOCK_SLACK_MS
  const fits = requests.filter((request) => {
    if (query.recordedIds.has(request.id)) return false
    const at = Date.parse(request.createdAt)
    if (!Number.isFinite(at) || at < earliest) return false
    // A request Seerr lists without its requester is unknown, not someone else's.
    if (
      query.requesterSeerrId != null &&
      request.requestedById != null &&
      request.requestedById !== query.requesterSeerrId
    ) {
      return false
    }
    if (query.is4k !== undefined && request.is4k !== query.is4k) return false
    if (query.seasons && query.seasons.length > 0 && request.seasons) {
      const asked = new Set(query.seasons)
      if (!request.seasons.some((season) => asked.has(season))) return false
    }
    return true
  })
  if (fits.length === 0) return null
  return fits.reduce((best, request) =>
    Date.parse(request.createdAt) < Date.parse(best.createdAt) ? request : best
  )
}

export type UnconfirmedOutcome = 'confirmed' | 'absent' | 'waiting'

/**
 * What to record for a request whose answer was lost.
 *
 * Found in Seerr = confirmed. Not found = absent only once Seerr could be read and
 * either the request is past `UNCONFIRMED_GIVE_UP_MS` or the person is asking for
 * the title again (`final`: they want a decision, and a request Seerr does not
 * list now is not one they have). An unreadable Seerr decides nothing.
 */
export function decideUnconfirmed(input: {
  lookupOk: boolean
  found: boolean
  since: Date
  now: Date
  final: boolean
}): UnconfirmedOutcome {
  if (input.found) return 'confirmed'
  if (!input.lookupOk) return 'waiting'
  if (input.final) return 'absent'
  return input.now.getTime() - input.since.getTime() >= UNCONFIRMED_GIVE_UP_MS ? 'absent' : 'waiting'
}

/** One unanswered row of a title, as `decideTitleRows` needs it. */
export interface UnansweredRow {
  id: string
  since: Date
  requesterSeerrId: number | null
  seasons: readonly number[] | null
}

/**
 * Decide every unanswered row of one title from one read of Seerr (`requests`
 * null = Seerr could not be read). Oldest first, and a request matched to one
 * row is not offered to the next, so two rows never claim the same request.
 */
export function decideTitleRows(
  rows: readonly UnansweredRow[],
  requests: readonly SeerrRequestTrace[] | null,
  recordedIds: ReadonlySet<number>,
  options: { now: Date; final: boolean }
): { id: string; outcome: UnconfirmedOutcome; seerrRequestId?: number }[] {
  const claimed = new Set(recordedIds)
  return [...rows]
    .sort((a, b) => a.since.getTime() - b.since.getTime())
    .map((row) => {
      const found = requests
        ? findSubmittedRequest(requests, {
            since: row.since,
            requesterSeerrId: row.requesterSeerrId,
            seasons: row.seasons,
            recordedIds: claimed,
          })
        : null
      const outcome = decideUnconfirmed({
        lookupOk: requests != null,
        found: found != null,
        since: row.since,
        now: options.now,
        final: options.final,
      })
      if (outcome === 'confirmed' && found) {
        claimed.add(found.id)
        return { id: row.id, outcome, seerrRequestId: found.id }
      }
      return { id: row.id, outcome }
    })
}
