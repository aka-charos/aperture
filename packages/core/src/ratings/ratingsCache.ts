/**
 * A per-key cache that keeps a successful answer for `ttlMs` and never keeps a
 * failure. Pure (no database), so qualityRatings.ts's caching is pinned by
 * ratingsCache.test.ts rather than by trust.
 *
 * `read` answers null for a failure: that call's caller gets `fallback()`, and
 * the next call reads again rather than serving the fallback for the rest of
 * the window. Concurrent callers inside the window share one read. A failure
 * removes only its own entry, never one a later read put in its place.
 */
export function createRatingsCache<K, V>(
  read: (key: K) => Promise<V | null>,
  fallback: () => V,
  ttlMs: number,
  now: () => number = Date.now
): (key: K) => Promise<V> {
  const entries = new Map<K, { at: number; value: Promise<V> }>()
  return (key) => {
    const at = now()
    const hit = entries.get(key)
    if (hit && at - hit.at < ttlMs) return hit.value
    const value: Promise<V> = read(key).then((answer) => {
      if (answer != null) return answer
      if (entries.get(key)?.value === value) entries.delete(key)
      return fallback()
    })
    entries.set(key, { at, value })
    return value
  }
}
