/**
 * Waiting on a chat turn's promises in a way that a Stop can end.
 *
 * After the reader stops a turn (helpers/activeTurns.ts `stopTurn`), the
 * stream's promises (`result.steps`, `result.text`) may settle late, reject, or
 * never settle at all, depending on where the abort landed. The turn must not
 * hang on them, and a rejection nobody awaits must not surface as an unhandled
 * one. So the wait resolves to `STOPPED` the moment the signal aborts, and the
 * promise's own outcome is then ignored.
 */

export const STOPPED: unique symbol = Symbol('stopped')

export function untilStopped<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal
): Promise<T | typeof STOPPED> {
  if (signal.aborted) {
    // Still observe the promise, so its rejection is handled.
    Promise.resolve(promise).catch(() => {})
    return Promise.resolve(STOPPED)
  }
  return new Promise<T | typeof STOPPED>((resolve, reject) => {
    const onAbort = () => resolve(STOPPED)
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        // A rejection caused by the stop is the stop, not a failure.
        if (signal.aborted) resolve(STOPPED)
        else reject(error)
      }
    )
  })
}
