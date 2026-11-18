/**
 * How the requests list filters by status and orders its rows.
 *
 * Pure: SQL fragments over a `discovery_requests` alias, shared by the count
 * and the page (`buildRequestFilter`, storage.ts) so the total always describes
 * the rows it pages through.
 *
 * The groups read the STORED status, which the reconcile job and the list
 * itself keep in step with Seerr (`resolveRequestStatus`), plus whether the
 * library holds the title. Each group is the set of chips the page can show for
 * it: `approved` covers approved, downloading and partly available, since
 * Seerr's request is approved in all three and only its media state differs.
 * An available request splits on the library: Seerr saying the file is in
 * place is "downloaded"; the media server having it, as of the last library
 * sync, is "in library". The library test matches `attachLibraryMediaIds`
 * (apps/api `lib/libraryLinks.ts`): a movie or series row with the same TMDb id.
 */

export const REQUEST_STATUS_GROUPS = [
  'waiting',
  'approved',
  'downloaded',
  'inLibrary',
  'declined',
  'failed',
] as const
export type RequestStatusGroup = (typeof REQUEST_STATUS_GROUPS)[number]

export function isRequestStatusGroup(value: unknown): value is RequestStatusGroup {
  return typeof value === 'string' && (REQUEST_STATUS_GROUPS as readonly string[]).includes(value)
}

/** Whether the library holds the requested title. */
export function requestInLibrarySql(alias: string): string {
  return `(CASE WHEN ${alias}.media_type = 'movie'
    THEN EXISTS (SELECT 1 FROM movies lm WHERE lm.tmdb_id = ${alias}.tmdb_id::text)
    ELSE EXISTS (SELECT 1 FROM series ls WHERE ls.tmdb_id = ${alias}.tmdb_id::text)
  END)`
}

export function requestStatusGroupSql(group: RequestStatusGroup, alias: string): string {
  switch (group) {
    case 'waiting':
      return `${alias}.status IN ('pending', 'submitted')`
    case 'approved':
      return `${alias}.status = 'approved'`
    case 'downloaded':
      return `(${alias}.status = 'available' AND NOT ${requestInLibrarySql(alias)})`
    case 'inLibrary':
      return `(${alias}.status = 'available' AND ${requestInLibrarySql(alias)})`
    case 'declined':
      return `${alias}.status = 'declined'`
    case 'failed':
      return `${alias}.status = 'failed'`
  }
}

export const REQUEST_SORTS = ['newest', 'oldest', 'titleAsc', 'titleDesc', 'recentChange'] as const
export type RequestSort = (typeof REQUEST_SORTS)[number]

export const DEFAULT_REQUEST_SORT: RequestSort = 'newest'

export function isRequestSort(value: unknown): value is RequestSort {
  return typeof value === 'string' && (REQUEST_SORTS as readonly string[]).includes(value)
}

/**
 * ORDER BY for a sort. Every order ends on the row id, so a page boundary never
 * shows a row twice or skips one when two rows tie. `recentChange` reads the
 * status stamp (`0215`), which older rows lack until their status next moves,
 * so it falls back to the last write.
 */
export function requestOrderSql(sort: RequestSort, alias: string): string {
  switch (sort) {
    case 'newest':
      return `${alias}.created_at DESC, ${alias}.id DESC`
    case 'oldest':
      return `${alias}.created_at ASC, ${alias}.id ASC`
    case 'titleAsc':
      return `lower(${alias}.title) ASC, ${alias}.created_at DESC, ${alias}.id DESC`
    case 'titleDesc':
      return `lower(${alias}.title) DESC, ${alias}.created_at DESC, ${alias}.id DESC`
    case 'recentChange':
      return `COALESCE(${alias}.status_changed_at, ${alias}.updated_at) DESC, ${alias}.id DESC`
  }
}
