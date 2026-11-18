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
 * `requestLibraryJoinSql` is the one test of "the library holds it": joined
 * as `REQUEST_LIBRARY_ALIAS`, the filter reads its id and the page selects its
 * id and title as the row's `libraryMediaId` / `libraryTitle`, which the chip
 * and the Open in library link read. One join, so the In library filter and
 * the In library chip cannot disagree, and a title only in a library the
 * viewer cannot open is "downloaded" to them, never a link that answers 404.
 */

import { libraryScopeSql, type BindParam, type LibraryScope } from '../lib/libraryScope.js'
import type { DiscoveryRequestStatus } from './types.js'

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

/** The alias `requestLibraryJoinSql` joins the library row under. */
export const REQUEST_LIBRARY_ALIAS = 'lib'

/**
 * LEFT JOIN LATERAL of the viewer's library row for the requested title
 * (`lib.id` as text, `lib.title`), NULL when no library in their scope holds
 * it. A null scope restricts nothing.
 */
export function requestLibraryJoinSql(alias: string, scope: LibraryScope | null, bind: BindParam): string {
  const movieScope = scope ? ` AND ${libraryScopeSql(scope, 'lm', bind)}` : ''
  const seriesScope = scope ? ` AND ${libraryScopeSql(scope, 'ls', bind)}` : ''
  // Each branch picks its row by a fixed order, so a title held by several
  // libraries (an HD and a 4K copy) opens the same copy on every load. The
  // branches exclude each other by media type, so at most one row comes back.
  return ` LEFT JOIN LATERAL (
      (SELECT lm.id::text AS id, lm.title FROM movies lm
        WHERE ${alias}.media_type = 'movie' AND lm.tmdb_id = ${alias}.tmdb_id::text${movieScope}
        ORDER BY lm.created_at, lm.id LIMIT 1)
      UNION ALL
      (SELECT ls.id::text AS id, ls.title FROM series ls
        WHERE ${alias}.media_type <> 'movie' AND ls.tmdb_id = ${alias}.tmdb_id::text${seriesScope}
        ORDER BY ls.created_at, ls.id LIMIT 1)
    ) ${REQUEST_LIBRARY_ALIAS} ON true`
}

/** Whether a group's test reads the library join. */
export function groupReadsLibrary(group: RequestStatusGroup): boolean {
  return group === 'downloaded' || group === 'inLibrary'
}

/** The WHERE test of a group. `downloaded`/`inLibrary` need `requestLibraryJoinSql` in the FROM. */
export function requestStatusGroupSql(group: RequestStatusGroup, alias: string): string {
  switch (group) {
    case 'waiting':
      return `${alias}.status IN ('pending', 'submitted')`
    case 'approved':
      return `${alias}.status = 'approved'`
    case 'downloaded':
      return `(${alias}.status = 'available' AND ${REQUEST_LIBRARY_ALIAS}.id IS NULL)`
    case 'inLibrary':
      return `(${alias}.status = 'available' AND ${REQUEST_LIBRARY_ALIAS}.id IS NOT NULL)`
    case 'declined':
      return `${alias}.status = 'declined'`
    case 'failed':
      return `${alias}.status = 'failed'`
  }
}

/**
 * Which groups a stored status can sit in, as one key: two statuses with the
 * same key are in the same group. `available` is one key because the library
 * half of its split does not move with the status.
 */
export function statusGroupKey(status: DiscoveryRequestStatus | string): string {
  if (status === 'pending' || status === 'submitted') return 'waiting'
  return status
}

/**
 * A stored status that moved while the list built a page, recorded by the list
 * or found recorded by someone else. A row's `status_changed_at` moves with
 * every status move, a restore putting an old date back included.
 */
export interface StatusMove {
  from: string
  to: string
}

/**
 * Whether a page must be read again because of statuses recorded while it was
 * built: the count and the rows were read first, so a row that left (or joined)
 * the filter, or moved in the latest-change order, makes them disagree with what
 * is stored. A move within one filter group changes nothing on the page. An
 * exact `status` filter (API clients) is left by any move. Pure, pinned.
 */
export function pageNeedsReread(
  moves: readonly StatusMove[],
  view: { status?: string; statusGroup?: RequestStatusGroup; sort?: RequestSort }
): boolean {
  return moves.some((move) => {
    if (move.from === move.to) return false
    if (view.status) return true
    if (view.statusGroup && statusGroupKey(move.from) !== statusGroupKey(move.to)) return true
    return view.sort === 'recentChange'
  })
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
 * status stamp (`0215`); a row older than it that has not moved since falls
 * back to when it was requested, never `updated_at`, which any write moves
 * (the reconcile job touches rows it re-checks without changing them).
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
      return `COALESCE(${alias}.status_changed_at, ${alias}.created_at) DESC, ${alias}.id DESC`
  }
}
