/**
 * How the requests list filters by status and orders its rows.
 *
 * Pure: SQL fragments over a `discovery_requests` alias, shared by the count
 * and the page (`buildRequestFilter`, storage.ts) so the total always describes
 * the rows it pages through.
 *
 * The groups read the STORED status, which the reconcile job and the list
 * itself keep in step with Seerr (`recordLiveRequestStatus`), plus whether the
 * library holds the title. Each group is the set of chips the page can show for
 * it: `approved` covers approved, downloading and partly available, since
 * Seerr's request is approved in all three and only its media state differs.
 * An available request splits on the library: Seerr saying the file is in
 * place is "downloaded"; the media server having it, as of the last library
 * sync, in a library the VIEWER can open, is "in library".
 *
 * `requestLibraryTitleSql` is the one test of "the library holds it": the
 * filter uses it, and the list selects it as the row's `libraryMediaId`, which
 * is what the page's chip and its Open in library link read. One expression, so
 * the In library filter and the In library chip cannot disagree, and a title
 * only in a library the viewer cannot open is "downloaded" to them, never a
 * link that answers 404.
 */

import { libraryScopeSql, type BindParam, type LibraryScope } from '../lib/libraryScope.js'

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

/**
 * The viewer's library row for the requested title (its id as text), or NULL
 * when no library in their scope holds it. A null scope restricts nothing.
 */
export function requestLibraryTitleSql(alias: string, scope: LibraryScope | null, bind: BindParam): string {
  const movieScope = scope ? ` AND ${libraryScopeSql(scope, 'lm', bind)}` : ''
  const seriesScope = scope ? ` AND ${libraryScopeSql(scope, 'ls', bind)}` : ''
  return `(CASE WHEN ${alias}.media_type = 'movie'
    THEN (SELECT lm.id::text FROM movies lm WHERE lm.tmdb_id = ${alias}.tmdb_id::text${movieScope} LIMIT 1)
    ELSE (SELECT ls.id::text FROM series ls WHERE ls.tmdb_id = ${alias}.tmdb_id::text${seriesScope} LIMIT 1)
  END)`
}

export function requestStatusGroupSql(
  group: RequestStatusGroup,
  alias: string,
  scope: LibraryScope | null,
  bind: BindParam
): string {
  switch (group) {
    case 'waiting':
      return `${alias}.status IN ('pending', 'submitted')`
    case 'approved':
      return `${alias}.status = 'approved'`
    case 'downloaded':
      return `(${alias}.status = 'available' AND ${requestLibraryTitleSql(alias, scope, bind)} IS NULL)`
    case 'inLibrary':
      return `(${alias}.status = 'available' AND ${requestLibraryTitleSql(alias, scope, bind)} IS NOT NULL)`
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
