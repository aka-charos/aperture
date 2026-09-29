/**
 * The Watch This page's decisions, pure so they are pinned by `sharedView.test.ts`.
 *
 * `SentStatus` mirrors core `social/rules.ts` by hand — the web bundle never
 * imports core. The server decides each status; this module only counts and
 * orders them.
 */

export type SharedTab = 'received' | 'sent'

export type SentStatus = 'unavailable' | 'watched' | 'watching' | 'waiting'

/** Header chips, in the order they read: what landed first, what cannot land last. */
export const STATUS_ORDER: readonly SentStatus[] = ['watched', 'watching', 'waiting', 'unavailable']

/** `?tab=` as a tab, or null for anything else (absent, stale, hand-typed). */
export function parseSharedTab(value: string | null): SharedTab | null {
  return value === 'received' || value === 'sent' ? value : null
}

/**
 * The tab to open on when the address names none: Received, unless there is
 * nothing there and something under Sent — the sidebar lists the entry for
 * someone who has only sent, and landing them on an empty tab reads as broken.
 * Decided once, after both lists load; later changes (dismissing the last
 * received title) must not move the reader to the other tab.
 */
export function defaultSharedTab(receivedCount: number, sentCount: number): SharedTab {
  return receivedCount === 0 && sentCount > 0 ? 'sent' : 'received'
}

/** How many titles sit in each status. Every status is present, zero or not. */
export function countStatuses(
  items: ReadonlyArray<{ status: SentStatus }>
): Record<SentStatus, number> {
  const counts: Record<SentStatus, number> = { watched: 0, watching: 0, waiting: 0, unavailable: 0 }
  for (const item of items) counts[item.status] += 1
  return counts
}

export type MediaKind = 'movie' | 'series'

/**
 * A person's titles as a Movies section and a Series section: movies first,
 * the order the dashboard's own Recent Watches columns use. Each keeps the
 * order it arrived in (newest first), and a kind with nothing is left out, so
 * an all-movies card shows one labelled section rather than an empty second.
 */
export function splitByType<T extends { mediaType: MediaKind }>(
  items: readonly T[]
): Array<{ type: MediaKind; items: T[] }> {
  return (['movie', 'series'] as const)
    .map((type) => ({ type, items: items.filter((item) => item.mediaType === type) }))
    .filter((section) => section.items.length > 0)
}

/** The newest `recommendedAt` in a group (ISO strings sort as dates), or null for none. */
export function latestSharedAt(items: ReadonlyArray<{ recommendedAt: string }>): string | null {
  let latest: string | null = null
  for (const item of items) {
    if (latest === null || item.recommendedAt > latest) latest = item.recommendedAt
  }
  return latest
}
