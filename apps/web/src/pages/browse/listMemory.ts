/**
 * What a Browse list looked like when the viewer left it, so Back can put them
 * where they were.
 *
 * The selection itself lives in the URL (urlState.ts). The position needs more:
 * the list is infinite, a long scroll means several pages already loaded, and
 * the API caps a page at 100 — so refetching to the old position costs several
 * requests and still lands before the layout is tall enough to scroll to. The
 * loaded items are kept instead, in memory, one per tab, and handed back only
 * when the selection is the same one (`key`: the list's own API query) and the
 * memory is recent. A reload of the page empties it, which is the right answer:
 * a reload asks for fresh data.
 *
 * Pure apart from the module-level store; the decision is pinned by a test.
 */

export type ListTab = 'movies' | 'series'

export interface ListSnapshot<T> {
  /** The list's API query (without the page number) it was loaded with. */
  key: string
  items: T[]
  page: number
  total: number
  hasMore: boolean
  scrollY: number
  savedAt: number
}

/** Older than this, a remembered list is refetched rather than shown. */
export const LIST_MEMORY_TTL_MS = 30 * 60 * 1000

const store = new Map<ListTab, ListSnapshot<unknown>>()

/** Whether a remembered list may stand in for the one about to be fetched. */
export function snapshotMatches(
  snapshot: Pick<ListSnapshot<unknown>, 'key' | 'savedAt' | 'items'> | undefined,
  key: string,
  now: number
): boolean {
  if (!snapshot) return false
  if (snapshot.key !== key) return false
  if (now - snapshot.savedAt > LIST_MEMORY_TTL_MS) return false
  return snapshot.items.length > 0
}

export function rememberList<T>(tab: ListTab, snapshot: ListSnapshot<T>): void {
  store.set(tab, snapshot as ListSnapshot<unknown>)
}

/**
 * Hand back the remembered list for this tab when it matches, and forget it
 * either way: it is used once, and the page remembers again when it is left.
 */
export function takeList<T>(tab: ListTab, key: string, now = Date.now()): ListSnapshot<T> | null {
  const snapshot = store.get(tab)
  store.delete(tab)
  return snapshotMatches(snapshot, key, now) ? (snapshot as ListSnapshot<T>) : null
}
