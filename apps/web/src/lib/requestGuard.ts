/**
 * Lets a slow answer be dropped once what it was started for is gone.
 *
 * The playlist dialogs start model calls that take seconds, and a dialog can be closed — or
 * reopened for a different playlist — before one answers. Applying that late answer wrote the old
 * playlist's fields back into whatever form was on screen next, where Save would store them on the
 * wrong playlist. A guard ends a "generation" (one opening of one dialog): everything started in it
 * is aborted, and anything that still resolves reports itself stale.
 *
 * Pure, so the rule is pinned by a test; `useRequestGuard` ties it to a component.
 */

export interface RequestTicket {
  /** Pass to `fetch`, so leaving also cancels the request rather than only ignoring it. */
  readonly signal: AbortSignal
  /** False once the generation this request was started in has ended. Check before applying. */
  isCurrent(): boolean
}

export interface RequestGuard {
  /** Start a request in the current generation. */
  begin(): RequestTicket
  /** End the current generation: abort everything started in it and make it stale. */
  invalidate(): void
}

export function createRequestGuard(): RequestGuard {
  let generation = 0
  // One controller per generation rather than per request, so nothing needs removing when a
  // request finishes and nothing accumulates across a long-lived dialog.
  let controller = new AbortController()

  return {
    begin() {
      const startedIn = generation
      return {
        signal: controller.signal,
        isCurrent: () => startedIn === generation,
      }
    },
    invalidate() {
      generation += 1
      controller.abort()
      controller = new AbortController()
    },
  }
}

/** Whether a rejection is the guard cancelling a request, which is not a failure to report. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
