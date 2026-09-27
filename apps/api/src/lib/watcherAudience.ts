/**
 * Who a viewer may see NAMED in a title's watch counters — the pure decision
 * behind `watcherVisibility.ts`, split out so it is pinned without loading the
 * database pool. No runtime imports.
 *
 * - An admin sees everyone (`all`) — a superset of their connections, so no
 *   connection query is run for them.
 * - A viewer with no visible connections sees nobody (`none`): the response
 *   carries no `watchers` key at all, exactly as before connections existed.
 * - A viewer with connections sees those connections AND THEMSELVES (`users`).
 *   Leaving the viewer out would count their own play among the anonymous
 *   "others" on a page they are looking at — "Joe and 1 other" where the other
 *   is them.
 */

export type WatcherAudience =
  /** Every watcher may be named (admins). */
  | { kind: 'all' }
  /** Nobody may be named — the caller omits the field entirely. */
  | { kind: 'none' }
  /** Only these users may be named: the viewer and their visible connections. */
  | { kind: 'users'; userIds: string[] }

export function resolveWatcherAudience(
  viewer: { id: string; isAdmin: boolean },
  visibleConnectionIds: readonly string[]
): WatcherAudience {
  if (viewer.isAdmin) return { kind: 'all' }
  if (visibleConnectionIds.length === 0) return { kind: 'none' }
  return { kind: 'users', userIds: [viewer.id, ...visibleConnectionIds] }
}

/**
 * The decided value the client picks its copy from ("only admins can see these
 * names" vs "names are shown only for you and your connections"). Only
 * meaningful when names were sent, so `none` has no label. The client is told
 * the answer, never the rule (F-134): it must not work this out from isAdmin.
 */
export function audienceLabel(audience: WatcherAudience): 'all' | 'connections' | undefined {
  if (audience.kind === 'all') return 'all'
  if (audience.kind === 'users') return 'connections'
  return undefined
}
