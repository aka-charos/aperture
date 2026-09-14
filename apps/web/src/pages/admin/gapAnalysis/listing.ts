/**
 * The Gap Analysis listing, as pure functions, so the rules the page leans on
 * are pinned by a test instead of re-derived inline.
 *
 * Two routes feed it and they disagree on purpose. `/latest` carries the scan's
 * per-collection counts, which counted a title as missing the moment it was
 * neither owned nor in Seerr; `/results` carries the open gaps themselves and
 * already hides anything requested since. So "missing" here is always the open
 * gaps actually listed, and the difference is reported as pending rather than
 * silently falling out of the arithmetic — otherwise a row reads "2 of 5 owned,
 * 1 missing" and two films are unaccounted for.
 */

export interface GapCollectionSummary {
  collectionId: number
  collectionName: string
  collectionPosterPath: string | null
  totalReleased: number
  ownedCount: number
  seerrCount: number
  missingCount: number
}

/** One open gap: released, not in the library, not in Seerr, not requested. */
export interface GapMissingTitle {
  tmdbId: number
  collectionId: number
  title: string
  releaseYear: number | null
  releaseDate?: string | null
  posterPath: string | null
}

export interface GapCollectionListing<T extends GapMissingTitle = GapMissingTitle> {
  collectionId: number
  name: string
  posterPath: string | null
  /** Released parts at scan time. */
  total: number
  owned: number
  /** Released, not owned, not an open gap: in Seerr at scan time, or requested since. */
  pending: number
  /** Open gaps, earliest release first — the next film in the series leads. */
  missing: T[]
}

export const GAP_SORTS = ['closest', 'mostMissing', 'name'] as const
export type GapSort = (typeof GAP_SORTS)[number]

/**
 * Buckets over the open-gap count. Measured on a 712-collection snapshot:
 * 429 miss one film, 230 miss two to four, 53 miss five or more — so a slider
 * over 0–49 spent 92% of its track on 7% of the rows.
 */
export const GAP_MISSING_FILTERS = ['any', 'one', 'few', 'many'] as const
export type GapMissingFilter = (typeof GAP_MISSING_FILTERS)[number]

interface Released {
  releaseDate?: string | null
  releaseYear: number | null
  title: string
}

/** Earliest first; an undated part sorts after every dated one. */
export function compareByRelease(a: Released, b: Released): number {
  const da = (a.releaseDate ?? '').slice(0, 10) || (a.releaseYear != null ? String(a.releaseYear) : '')
  const db = (b.releaseDate ?? '').slice(0, 10) || (b.releaseYear != null ? String(b.releaseYear) : '')
  if (da !== db) {
    if (!da) return 1
    if (!db) return -1
    return da.localeCompare(db)
  }
  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
}

/**
 * Joins scan counts to open gaps. A collection with no open gap is dropped
 * (nothing to act on), and so is a gap whose collection has no summary yet —
 * mid-scan the two arrive from separate requests, and the next poll fills it in.
 */
export function buildGapListings<T extends GapMissingTitle>(
  summaries: readonly GapCollectionSummary[],
  missing: readonly T[]
): GapCollectionListing<T>[] {
  const byCollection = new Map<number, T[]>()
  for (const row of missing) {
    const list = byCollection.get(row.collectionId)
    if (list) list.push(row)
    else byCollection.set(row.collectionId, [row])
  }

  const listings: GapCollectionListing<T>[] = []
  for (const summary of summaries) {
    const rows = byCollection.get(summary.collectionId)
    if (!rows?.length) continue
    listings.push({
      collectionId: summary.collectionId,
      name: summary.collectionName,
      posterPath: summary.collectionPosterPath,
      total: summary.totalReleased,
      owned: summary.ownedCount,
      pending: Math.max(0, summary.totalReleased - summary.ownedCount - rows.length),
      missing: [...rows].sort(compareByRelease),
    })
  }
  return listings
}

/** Case- and accent-insensitive, since nobody types the accent in "Purché". */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * A collection matches on its own name or on any film it is missing. The row
 * keeps every missing film either way: narrowing it to the match would leave a
 * "Request all" button that requests less than all.
 */
export function listingMatchesSearch(listing: GapCollectionListing, query: string): boolean {
  const q = foldForSearch(query.trim())
  if (!q) return true
  if (foldForSearch(listing.name).includes(q)) return true
  return listing.missing.some((m) => foldForSearch(m.title).includes(q))
}

export function matchesMissingFilter(missingCount: number, filter: GapMissingFilter): boolean {
  switch (filter) {
    case 'one':
      return missingCount === 1
    case 'few':
      return missingCount >= 2 && missingCount <= 4
    case 'many':
      return missingCount >= 5
    default:
      return true
  }
}

/** Share of released parts that are no longer an open gap (owned or pending). */
export function closedShare(listing: GapCollectionListing): number {
  return listing.total > 0 ? (listing.total - listing.missing.length) / listing.total : 0
}

/**
 * `closest` is the default because it is the actionable end: 24 of 26 Bonds
 * before a 51-film serial someone owns two of. Ties (every 1-of-2) break on
 * fewer films to finish, then on more already owned.
 */
export function sortGapListings<T extends GapMissingTitle>(
  listings: readonly GapCollectionListing<T>[],
  sort: GapSort
): GapCollectionListing<T>[] {
  const byName = (a: GapCollectionListing<T>, b: GapCollectionListing<T>) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

  const compare =
    sort === 'name'
      ? byName
      : sort === 'mostMissing'
        ? (a: GapCollectionListing<T>, b: GapCollectionListing<T>) =>
            b.missing.length - a.missing.length || byName(a, b)
        : (a: GapCollectionListing<T>, b: GapCollectionListing<T>) =>
            closedShare(b) - closedShare(a) ||
            a.missing.length - b.missing.length ||
            b.owned - a.owned ||
            byName(a, b)

  return [...listings].sort(compare)
}

export type RelativeUnit = 'minute' | 'hour' | 'day' | 'month' | 'year'

/**
 * A value and unit for `Intl.RelativeTimeFormat`. Floors rather than rounds, so
 * 359 days reads "11 months ago" and never "12 months ago" beside a date in
 * last year's April; zero is a positive 0, which formats as "now" rather than
 * "0 minutes ago".
 */
export function relativeTimeParts(then: Date, now: Date): { value: number; unit: RelativeUnit } {
  const delta = then.getTime() - now.getTime()
  const sign = delta < 0 ? -1 : 1
  const signed = (n: number) => (n === 0 ? 0 : sign * n)
  const minutes = Math.abs(delta) / 60_000
  if (minutes < 60) return { value: signed(Math.floor(minutes)), unit: 'minute' }
  const hours = minutes / 60
  if (hours < 24) return { value: signed(Math.floor(hours)), unit: 'hour' }
  const days = hours / 24
  if (days < 30) return { value: signed(Math.floor(days)), unit: 'day' }
  if (days < 365) return { value: signed(Math.floor(days / 30)), unit: 'month' }
  return { value: signed(Math.floor(days / 365)), unit: 'year' }
}
