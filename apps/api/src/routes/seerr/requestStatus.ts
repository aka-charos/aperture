/**
 * What the requests list says about one request, decided here so the page
 * renders an answer rather than re-deriving it (the web never imports core).
 *
 * The chip is a REFINEMENT of the stored status, never a second opinion: the
 * caller passes the status as `resolveRequestStatus` leaves it after Seerr's
 * live answer, and Seerr's media state only adds detail within it (downloading,
 * partly available). So each key falls inside the filter group of core
 * `discover/requestListing.ts` that the stored status belongs to, including
 * where the sweep refuses to walk a status back (an approved request Seerr
 * calls pending again stays "approved", in the list and in the filter).
 *
 * An available request is split by the library: Seerr reporting the file in
 * place is `downloaded`; a library the viewer can open holding the title, as of
 * the last library sync, is `inLibrary`.
 *
 * Pure, no runtime imports: pinned by `requestStatus.test.ts`.
 */

export type RequestStatusKey =
  | 'inLibrary'
  | 'downloaded'
  | 'partiallyAvailable'
  | 'processing'
  | 'approved'
  | 'pendingApproval'
  | 'awaitingSeerr'
  | 'submitted'
  | 'pending'
  | 'declined'
  | 'failed'

export interface RequestStatusInput {
  /** The stored status, after `resolveRequestStatus` applied Seerr's live answer. */
  status: string
  awaitingSeerr: boolean
  live: {
    status: 'pending' | 'approved' | 'declined' | 'completed'
    mediaStatus: 'unknown' | 'pending' | 'processing' | 'partially_available' | 'available'
  } | null
  inLibrary: boolean
}

/**
 * Seerr's live answer as the routes send it: request and media status only.
 * Core's answer also carries Seerr's last-change date, which the restore rule
 * reads and no response documents.
 */
export function liveForClient(
  live: NonNullable<RequestStatusInput['live']> | null
): RequestStatusInput['live'] {
  return live ? { status: live.status, mediaStatus: live.mediaStatus } : null
}

export function decideRequestStatus(input: RequestStatusInput): RequestStatusKey | null {
  const { live } = input
  switch (input.status) {
    case 'available':
      return input.inLibrary ? 'inLibrary' : 'downloaded'
    case 'approved':
      if (live?.mediaStatus === 'partially_available') return 'partiallyAvailable'
      if (live?.mediaStatus === 'processing') return 'processing'
      return 'approved'
    case 'submitted':
      // Seerr holds it and has not decided: "Pending approval" once it says so.
      return live ? 'pendingApproval' : 'submitted'
    case 'pending':
      if (live) return 'pendingApproval'
      return input.awaitingSeerr ? 'awaitingSeerr' : 'pending'
    case 'declined':
      return 'declined'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}
