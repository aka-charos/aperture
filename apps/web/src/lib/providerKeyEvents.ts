/**
 * "This provider's saved API key just changed" — a one-shot signal to every
 * role card on the page.
 *
 * A key is shared across the roles on a provider. Removing one clears it from
 * every role, not only the one whose card was clicked (core
 * `forgetProviderApiKey`, since one role's key is lent to the others), and
 * saving one publishes it to the shared store the other cards read. Those cards
 * were loaded with what was true then and nothing tells them otherwise until the
 * page reloads, so they show a key that is gone, or no key while one is in use.
 *
 * An event rather than shared state, for `watchStatusEvents.ts`'s reason: it
 * fires once, to whoever is listening, and leaves nothing to be cleared.
 */

/**
 * `removed`: every role's copy is gone, so a card stops believing its own.
 * `saved`: the shared store may hold one now, so a card asks again.
 */
export type ProviderKeyChange = 'removed' | 'saved'

type Listener = (provider: string, change: ProviderKeyChange) => void

const listeners = new Set<Listener>()

/** Subscribe; returns the unsubscribe, shaped for a `useEffect` cleanup. */
export function onProviderKeyChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitProviderKeyChanged(provider: string, change: ProviderKeyChange): void {
  // Copied before iterating, so a listener that unsubscribes mid-loop is safe.
  for (const listener of [...listeners]) listener(provider, change)
}
