/**
 * What the requests list says about one request, decided here so the page
 * renders an answer rather than re-deriving it (the web never imports core).
 *
 * Seerr's live answer wins over the stored status where there is one. An
 * available request is split by the library: Seerr reporting the file in place
 * (Radarr/Sonarr imported it) is `downloaded`; the media server holding the
 * title, as of the last library sync, is `inLibrary`. Every key falls inside one
 * filter group of core `discover/requestListing.ts`, so a filtered list shows
 * only the chips its filter names once the stored status has caught up.
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
  status: string
  awaitingSeerr: boolean
  live: {
    status: 'pending' | 'approved' | 'declined' | 'completed'
    mediaStatus: 'unknown' | 'pending' | 'processing' | 'partially_available' | 'available'
  } | null
  inLibrary: boolean
}

export function decideRequestStatus(input: RequestStatusInput): RequestStatusKey | null {
  const { live } = input
  const arrived = (): RequestStatusKey => (input.inLibrary ? 'inLibrary' : 'downloaded')
  if (live) {
    if (live.mediaStatus === 'available' || live.status === 'completed') return arrived()
    if (live.status === 'declined') return 'declined'
    if (live.status === 'pending') return 'pendingApproval'
    if (live.mediaStatus === 'partially_available') return 'partiallyAvailable'
    if (live.mediaStatus === 'processing') return 'processing'
    return 'approved'
  }
  switch (input.status) {
    case 'available':
      return arrived()
    case 'submitted':
      return 'submitted'
    case 'pending':
      return input.awaitingSeerr ? 'awaitingSeerr' : 'pending'
    case 'approved':
      return 'approved'
    case 'declined':
      return 'declined'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}
