/**
 * localStorage caches that hold ONE user's data under a fixed key.
 *
 * None of them is namespaced by user id, which is invisible while a browser
 * only ever holds one identity — and immediately wrong when an admin starts
 * viewing the app as someone else, where the admin's cached "Shows You Watch"
 * list would render as the target's until the background fetch corrected it.
 *
 * The keys live here rather than beside their providers because a provider
 * module exporting a plain constant alongside its component trips
 * `react-refresh/only-export-components`, and lint runs at --max-warnings 0.
 * One home also means the list cannot fall out of step with the providers that
 * write it, which is the failure a second hand-kept copy would produce.
 */

export const WATCHING_CACHE_KEY = 'aperture_watching_cache'
export const VIEW_MODES_CACHE_KEY = 'aperture-view-modes'
export const POSTER_PREFS_CACHE_KEY = 'aperture-poster-prefs'

const USER_SCOPED_CACHE_KEYS = [
  WATCHING_CACHE_KEY,
  VIEW_MODES_CACHE_KEY,
  POSTER_PREFS_CACHE_KEY,
]

/**
 * Drop every cache that belongs to whoever the browser was a moment ago.
 *
 * Called on both edges of an assumed session — entering and leaving — because
 * a stale cache is equally wrong in both directions.
 */
export function clearUserScopedCaches(): void {
  for (const key of USER_SCOPED_CACHE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      // localStorage unavailable (private mode, blocked site data). The caches
      // are an optimisation; losing the ability to clear one costs a stale
      // first paint, never correctness.
    }
  }
}
