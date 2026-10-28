/**
 * "This provider's saved API key was just removed" — a one-shot signal to every
 * role card on the page.
 *
 * Removing a key clears it from every role on that provider, not only the one
 * whose card was clicked (core `forgetProviderApiKey`, since one role's key is
 * lent to the others). The other cards were loaded with "a key is saved" and
 * nothing tells them otherwise until the page reloads, so they keep showing a
 * key that is gone and a Remove button that removes nothing.
 *
 * An event rather than shared state, for `watchStatusEvents.ts`'s reason: it
 * fires once, to whoever is listening, and leaves nothing to be cleared.
 */

type Listener = (provider: string) => void

const listeners = new Set<Listener>()

/** Subscribe; returns the unsubscribe, shaped for a `useEffect` cleanup. */
export function onProviderKeyRemoved(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitProviderKeyRemoved(provider: string): void {
  // Copied before iterating, so a listener that unsubscribes mid-loop is safe.
  for (const listener of [...listeners]) listener(provider)
}
