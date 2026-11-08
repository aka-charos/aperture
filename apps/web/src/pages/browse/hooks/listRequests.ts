/**
 * Loading one page of a Browse list, and deciding whether its reply still applies.
 *
 * Each Browse list (movies, series, people) asks for page one when what it
 * shows changes and for the next page as the reader scrolls. Nothing used to
 * cancel a request once sent, so a slow reply to an older query could land
 * after the newer one and replace it, its rows and total shown under the new
 * filters, and an old "load more" could append its rows to a different list.
 * The list memory then filed those rows under the new query, so Back restored
 * them.
 *
 * The rule, in one place for all three lists:
 *   - A list holds a request guard whose generation ends whenever its key (what
 *     the list shows) changes (`useListRequests`).
 *   - Asking for page one starts a new list, so it ends the generation too,
 *     which cancels a "load more" still in flight for the list it replaces.
 *   - A reply is applied only while its request is current; a stale one,
 *     including a cancelled one, reports `stale` and the caller touches nothing,
 *     loading flags included (the request that replaced it owns them).
 *
 * Pure apart from the `fetch` it is handed, so the rule is tested without React.
 */
import type { RequestGuard } from '../../../lib/requestGuard'

export interface ListPage<T> {
  items: T[]
  total: number
}

export type ListPageOutcome<T> =
  | { kind: 'page'; page: ListPage<T> }
  /** The server answered with an error status. */
  | { kind: 'failed' }
  /** The request or its body could not be read (network, bad JSON). */
  | { kind: 'unreachable' }
  /** Superseded or cancelled: apply nothing. */
  | { kind: 'stale' }

export interface LoadListPageOptions<T> {
  guard: RequestGuard
  url: string
  /** True for "load more"; false starts a new list. */
  append: boolean
  /** The page's rows and total, out of the response body. */
  read: (body: unknown) => ListPage<T>
  fetchImpl?: typeof fetch
}

export async function loadListPage<T>({
  guard,
  url,
  append,
  read,
  fetchImpl = fetch,
}: LoadListPageOptions<T>): Promise<ListPageOutcome<T>> {
  if (!append) guard.invalidate()
  const ticket = guard.begin()

  try {
    const response = await fetchImpl(url, { credentials: 'include', signal: ticket.signal })
    if (!ticket.isCurrent()) return { kind: 'stale' }
    if (!response.ok) return { kind: 'failed' }

    const page = read(await response.json())
    if (!ticket.isCurrent()) return { kind: 'stale' }
    return { kind: 'page', page }
  } catch {
    return ticket.isCurrent() ? { kind: 'unreachable' } : { kind: 'stale' }
  }
}
