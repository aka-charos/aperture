/**
 * What one part of a TMDb collection is to this library, decided once.
 *
 * Two surfaces ask it: admin gap analysis, which scans every collection, and
 * the franchise page, which answers for one. Both need the same rule for
 * "has this been released" and the same reading of a Seerr status, and a
 * second copy would disagree with the first the moment one of them changed —
 * a part listed as a gap on one screen and as upcoming on the other.
 *
 * Pure, with no runtime imports, so the rules are pinned by a test without
 * pulling in the database pool.
 */

/** A part's standing in Seerr, reduced to what either surface acts on. */
export type SeerrStatus = 'none' | 'requested' | 'processing' | 'available'

/** How the franchise page files a part. */
export type CollectionPartStatus =
  | 'owned'
  | 'available'
  | 'requested'
  | 'processing'
  | 'missing'
  | 'upcoming'

export interface ClassifiedCollectionPart {
  status: CollectionPartStatus
  /** Seerr's view, kept separately so an upcoming part can still show a pending request. */
  seerrStatus: SeerrStatus
  /** True only for a released part nobody has on the server or in the request pipeline. */
  requestable: boolean
}

/** The shape `batchGetMediaStatus` returns per title. */
export interface SeerrMediaStatusLike {
  exists: boolean
  status: string
  requested: boolean
}

/**
 * Whether a TMDb release date is today or earlier, compared in UTC.
 *
 * Null, empty and unparseable dates read as unreleased: TMDb lists announced
 * parts with no date at all, and those are the ones that must not be offered
 * for request.
 */
export function isReleasedReleaseDate(
  releaseDate: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (releaseDate == null || typeof releaseDate !== 'string') return false
  const s = releaseDate.trim()
  if (s.length < 10) return false
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false
  const releaseUtc = Date.UTC(y, mo - 1, d)
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return releaseUtc <= todayUtc
}

/** No status from Seerr reads as `none`: Seerr unconfigured, or a title it has never seen. */
export function deriveSeerrStatus(st: SeerrMediaStatusLike | undefined): SeerrStatus {
  if (!st) return 'none'
  if (st.exists) return 'available'
  if (st.status === 'processing') return 'processing'
  if (st.requested) return 'requested'
  return 'none'
}

/**
 * File one collection part. Order matters, and each step is a decision:
 *
 * 1. In the library wins outright — including a film whose TMDb date is still
 *    in the future, which is what an early digital release looks like.
 * 2. Unreleased is never requestable. Its Seerr status still rides along, so a
 *    request someone already filed is not hidden behind "upcoming".
 * 3. Seerr has it but this library does not: not requestable, since asking
 *    for a title the server already holds is a request that does nothing. It
 *    appears here after the next sync.
 * 4. Already in Seerr's pipeline: that status, not requestable.
 * 5. Otherwise it is missing, and it is the only case that can be requested.
 */
export function classifyCollectionPart(input: {
  releaseDate: string | null | undefined
  inLibrary: boolean
  seerr?: SeerrMediaStatusLike
  now?: Date
}): ClassifiedCollectionPart {
  const seerrStatus = input.inLibrary ? 'available' : deriveSeerrStatus(input.seerr)

  if (input.inLibrary) {
    return { status: 'owned', seerrStatus, requestable: false }
  }
  if (!isReleasedReleaseDate(input.releaseDate, input.now)) {
    return { status: 'upcoming', seerrStatus, requestable: false }
  }
  if (seerrStatus === 'none') {
    return { status: 'missing', seerrStatus, requestable: true }
  }
  return { status: seerrStatus, seerrStatus, requestable: false }
}
