/**
 * A tab left open across a deploy.
 *
 * Asset filenames are hashed and a deploy swaps the image, so a tab still running
 * the previous build asks for chunks the server no longer has: the next page it
 * opens, the chat, a language. Reloading is the whole fix, because the new shell
 * names the new files.
 *
 * Once per build, remembered for the tab: a chunk that fails again from the same
 * build is not a stale tab (the network, a proxy), and reloading again would
 * loop. `PageErrorBoundary` shows that failure with a Reload button. The next
 * deploy is a new build and gets its own attempt. With no working sessionStorage
 * there is no way to remember, so nothing reloads by itself.
 *
 * Not while the viewer is doing something a reload would throw away. Moving to a
 * page abandons the old one anyway, but a dialog or drawer opens over a form or a
 * chat in progress, and so does the chat over a page: those failures get the
 * boundary's message and Reload button, and the viewer decides when. Hence
 * `keepPageOnChunkFailure` around such an import and `useChunkReloadHold` for as
 * long as a chat is open beside the pages. A hold spends no attempt.
 */
import { useEffect } from 'react'


/** Just the part of sessionStorage this needs. */
type MarkerStore = Pick<Storage, 'getItem' | 'setItem'>

const MARKER_PREFIX = 'aperture:chunk-reload:'

/** True at most once per build per store: the caller may reload. */
export function claimChunkReload(store: MarkerStore, buildId: string): boolean {
  const key = MARKER_PREFIX + buildId
  try {
    if (store.getItem(key) !== null) return false
    store.setItem(key, '1')
    return true
  } catch {
    return false
  }
}

let holds = 0

/** No automatic reload until the returned function is called. Safe to call twice. */
export function holdChunkReload(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
  }
}

/** Wraps the import of something that opens over a page rather than replacing it. */
export function keepPageOnChunkFailure<T>(load: () => Promise<T>): Promise<T> {
  // Vite raises its event before the import rejects, so this is still held then.
  const release = holdChunkReload()
  return load().finally(release)
}

export function useChunkReloadHold(active: boolean): void {
  useEffect(() => (active ? holdChunkReload() : undefined), [active])
}

let reloading = false

/** A reload is on its way: boundaries keep a spinner up rather than show an error. */
export function isChunkReloadPending(): boolean {
  return reloading
}

/**
 * Listen for a chunk failing to load. Vite raises this for every dynamic import
 * in a build, so the routes, the locales and the admin sections share one
 * handler. The event is not cancelled: the import still rejects, so nothing
 * carries on with an undefined module while the page goes away.
 *
 * `buildId` comes from the caller's `import.meta.url`: the entry chunk's hashed
 * name changes whenever any chunk does.
 */
export function installChunkReload(buildId: string): void {
  window.addEventListener('vite:preloadError', () => {
    if (reloading || holds > 0) return
    let store: MarkerStore
    try {
      store = window.sessionStorage
    } catch {
      return
    }
    if (!claimChunkReload(store, buildId)) return
    reloading = true
    window.location.reload()
  })
}
