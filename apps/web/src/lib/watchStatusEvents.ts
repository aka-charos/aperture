/**
 * "This title was just marked watched" — a one-shot signal across the tree.
 *
 * The watch-date prompt lives in `UserRatingsProvider`, near the root, because
 * rating happens on a dozen surfaces. The thing it changes — the Mark Watched
 * button and the Watched chip — lives on the media detail page, a long way
 * down and reachable by no prop. Without this, the prompt writes the play, the
 * server has it, and the page keeps offering to mark watched something it just
 * marked watched.
 *
 * Deliberately an event rather than a piece of shared state. State would have
 * to be cleared after reading, and until it was, navigating away from the film
 * and back would re-apply a stale "you watched this" over a status the page had
 * just fetched — including after the viewer had unmarked it. An event fires
 * once, to whoever is listening at the time, and leaves nothing behind.
 */

export interface MovieWatchedEvent {
  movieId: string
  /**
   * When the play was recorded, ISO. For a band-dated backfill this is the
   * estimate the server resolved, not now — the two can be a year apart, and
   * the page should not claim the wrong one.
   */
  watchedAt: string | null
}

type Listener = (event: MovieWatchedEvent) => void

const listeners = new Set<Listener>()

/** Subscribe; returns the unsubscribe, shaped for a `useEffect` cleanup. */
export function onMovieWatched(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitMovieWatched(event: MovieWatchedEvent): void {
  // Copied before iterating: a listener that unsubscribes itself while being
  // notified would otherwise mutate the set mid-loop.
  for (const listener of [...listeners]) listener(event)
}
