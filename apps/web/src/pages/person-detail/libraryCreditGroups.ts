/**
 * The person page's library titles, grouped by medium and role ("Movies ·
 * Acting", "TV Series · Director"), the same grouping its "Not in your
 * library" section gets from TMDb. Pure, so the grouping is pinned by
 * `libraryCreditGroups.test.ts`.
 *
 * Roles come from two places and are unioned: the media server's credits on
 * each title (cast, directors, writers, a show's TMDb creators), and TMDb's
 * credits for the same title matched by TMDb id, which add producer and other
 * crew roles the media server does not record. A title credited twice (acted
 * in and directed) appears in both groups, as it does in the TMDb section.
 */

export type CreditRole = 'actor' | 'director' | 'producer' | 'writer' | 'creator' | 'other'
export type CreditMedia = 'movie' | 'tv'

/** The order the TMDb section draws its groups in, kept identical. */
export const CREDIT_GROUP_ORDER: readonly `${CreditMedia}:${CreditRole}`[] = [
  'movie:actor',
  'movie:director',
  'movie:producer',
  'movie:writer',
  'movie:creator',
  'movie:other',
  'tv:actor',
  'tv:director',
  'tv:producer',
  'tv:writer',
  'tv:creator',
  'tv:other',
]

const ROLES: ReadonlySet<string> = new Set<CreditRole>(['actor', 'director', 'producer', 'writer', 'creator', 'other'])

export interface LibraryCreditItem {
  id: string
  tmdbId?: string | null
  /** From the media server; absent from a server built before it was sent. */
  credits?: string[]
}

export interface TmdbLibraryCredit {
  tmdbId: number
  mediaType: CreditMedia
  roleKind: string
}

export interface LibraryCreditGroup<T> {
  groupKey: `${CreditMedia}:${CreditRole}`
  media: CreditMedia
  role: CreditRole
  items: T[]
}

export function groupLibraryCredits<T extends LibraryCreditItem>(
  movies: readonly T[],
  series: readonly T[],
  tmdbInLibrary: readonly TmdbLibraryCredit[]
): LibraryCreditGroup<T>[] {
  const tmdbRoles = new Map<string, Set<CreditRole>>()
  for (const credit of tmdbInLibrary) {
    if (!ROLES.has(credit.roleKind)) continue
    const key = `${credit.mediaType}:${credit.tmdbId}`
    if (!tmdbRoles.has(key)) tmdbRoles.set(key, new Set())
    tmdbRoles.get(key)!.add(credit.roleKind as CreditRole)
  }

  const buckets = new Map<string, T[]>()
  const place = (media: CreditMedia, items: readonly T[]) => {
    for (const item of items) {
      const roles = new Set<CreditRole>()
      for (const credit of item.credits ?? []) {
        if (ROLES.has(credit)) roles.add(credit as CreditRole)
      }
      if (item.tmdbId) {
        for (const role of tmdbRoles.get(`${media}:${item.tmdbId}`) ?? []) roles.add(role)
      }
      // Every title here was found BY a credit, so an empty set means the
      // server did not say which one; it is still this person's title.
      if (roles.size === 0) roles.add('other')
      for (const role of roles) {
        const key = `${media}:${role}`
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key)!.push(item)
      }
    }
  }
  place('movie', movies)
  place('tv', series)

  return CREDIT_GROUP_ORDER.filter((key) => buckets.has(key)).map((groupKey) => {
    const [media, role] = groupKey.split(':') as [CreditMedia, CreditRole]
    return { groupKey, media, role, items: buckets.get(groupKey)! }
  })
}
