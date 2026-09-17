/**
 * A ceiling for a streamed model call that can tell SLOW from HUNG, and a way
 * for a cancelled job to reach a call that is already in flight.
 *
 * WHY THIS EXISTS, measured. A title analysis run sat on one title for
 * **8 hours 45 minutes** and could not be stopped. Three things had to be true
 * at once, and they were:
 *
 *  1. `analysis/generate.ts` passed `streamText` no `abortSignal`, and the
 *     OpenRouter provider's fetch carries no timeout of its own (the one
 *     `AbortSignal.timeout` on that provider covers the credits lookup).
 *  2. Streaming removed the only ceiling that used to apply by accident. A
 *     non-streaming call gets no response headers until the model finishes, so
 *     Node's own `headersTimeout` (300s, which no AbortSignal can extend) ended
 *     a wedged call whether anyone had asked for that or not. An SSE response
 *     sends headers at once, so neither of Node's timeouts is ever approached —
 *     which is exactly why streaming was adopted, and exactly what left a
 *     stalled stream with nothing to end it.
 *  3. Job cancellation is cooperative and the analysis job polls it BETWEEN
 *     titles, so Stop set a status that the one stuck title never read. The
 *     executor holds the job's slot until the work exits, so the job could
 *     neither finish nor be started again.
 *
 * WHY STALL RATHER THAN A WALL-CLOCK CAP. A flat cap cannot tell a slow call
 * from a hung one, which is the same argument that put `LOCAL_INFERENCE_TIMEOUT_MS`
 * at a full hour: a large local model legitimately spends 45 minutes on one
 * answer, so any cap low enough to catch a hang quickly also kills healthy
 * work. Silence is the signal that does separate them — a stream delivering
 * anything at all is alive, and one that has delivered nothing for ten minutes
 * is not. The absolute deadline stays available as a backstop for the
 * pathological case (a provider dribbling one token an hour), never as the
 * primary instrument.
 *
 * WHY A TIMESTAMP AND AN INTERVAL, not a timer reset per chunk. A delta arrives
 * per token, so rescheduling a timeout on every chunk is thousands of timer
 * operations per answer; this stores one number and reads it on a fixed
 * interval, the same shape the write heartbeat already uses.
 */

export type StreamAbortReason = 'stalled' | 'deadline' | 'cancelled'

export interface StreamStallGuard {
  /** Pass to `streamText`/`fetch`. Aborts when the guard decides. */
  readonly signal: AbortSignal
  /**
   * Resolves with the reason when the guard aborts, and otherwise never.
   *
   * THIS IS WHAT MAKES THE SIGNAL SUFFICIENT, and it is measured rather than
   * assumed. On `ai@5.0.118`, against a server that sends one SSE chunk and
   * then goes silent, aborting the signal closes the socket (the server sees
   * the client abort) and then:
   *
   *   - `await stream.text` **never settles** — not resolved, not rejected —
   *     and `onAbort` is never called either;
   *   - `for await (const part of stream.fullStream)` throws `AI_APICallError`;
   *   - `for await (const delta of stream.textStream)` throws the same;
   *   - `await stream.consumeStream()` resolves.
   *
   * So a caller that awaits the promise bundle — which is the shape the
   * analysis writer uses, because it reads a stream exactly as it used to read
   * a non-streaming result — gets no notification at all, and the abort fixes
   * the socket while leaving the caller hung exactly as before. Racing against
   * this promise is what ends the caller's wait; a caller that consumes the
   * stream itself does not need it.
   */
  readonly aborted: Promise<StreamAbortReason>
  /**
   * Why it aborted, or null while the call is still alive.
   *
   * Read this rather than inspecting the rejection: whether an aborted
   * `streamText` rejects or resolves with what it had is the SDK's business,
   * and a caller that branches on the rejection alone gets the other case
   * wrong. The three reasons want three different answers — a cancellation is
   * not a failure, and a stall is not an unusable response.
   */
  reason(): StreamAbortReason | null
  /** Record that the stream produced something. Cheap by design. */
  activity(): void
  /** Always call this, in a `finally`. */
  stop(): void
}

export interface StreamStallOptions {
  /** Silence, in ms, that counts as hung. */
  stallMs: number
  /** Absolute ceiling in ms, however lively the stream is. Omit for none. */
  deadlineMs?: number
  /** How often the guard looks, and how often cancellation is polled. */
  checkMs?: number
  /** Polled while the call runs, so Stop can reach an in-flight request. */
  shouldCancel?: () => Promise<boolean> | boolean
  /** Called once, when the guard aborts, so the caller can log it. */
  onAbort?: (reason: StreamAbortReason, elapsedMs: number) => void
}

const DEFAULT_CHECK_MS = 1000

const ABORT_MESSAGES: Record<StreamAbortReason, string> = {
  stalled: 'the model stream went silent',
  deadline: 'the call passed its absolute deadline',
  cancelled: 'the job was cancelled',
}

export function startStreamStallGuard(options: StreamStallOptions): StreamStallGuard {
  const controller = new AbortController()
  const startedAt = Date.now()
  let lastActivityAt = startedAt
  let reason: StreamAbortReason | null = null
  // Deliberately never rejected: this promise says "the call was abandoned",
  // and a caller racing it wants one branch rather than a second error path.
  let announce: (reason: StreamAbortReason) => void = () => {}
  const aborted = new Promise<StreamAbortReason>((resolve) => {
    announce = resolve
  })
  // A cancellation poll may be asynchronous, and the interval must not stack
  // several of them on a slow answer.
  let polling = false

  const abort = (next: StreamAbortReason): void => {
    if (reason) return
    reason = next
    clearInterval(timer)
    options.onAbort?.(next, Date.now() - startedAt)
    controller.abort(new Error(`Aborted: ${ABORT_MESSAGES[next]}`))
    // After the abort, so a caller woken by this promise can already read the
    // reason off the signal.
    announce(next)
  }

  const timer = setInterval(() => {
    if (reason) return
    const now = Date.now()
    if (options.deadlineMs != null && now - startedAt >= options.deadlineMs) {
      abort('deadline')
      return
    }
    if (now - lastActivityAt >= options.stallMs) {
      abort('stalled')
      return
    }
    if (!options.shouldCancel || polling) return
    polling = true
    Promise.resolve()
      .then(() => options.shouldCancel?.())
      .then((cancelled) => {
        if (cancelled === true) abort('cancelled')
      })
      // A poll that throws must not end a healthy call: it says nothing about
      // the stream, and the stall and deadline checks still hold.
      .catch(() => {})
      .finally(() => {
        polling = false
      })
  }, options.checkMs ?? DEFAULT_CHECK_MS)
  // Load-bearing: a pending interval keeps the Node event loop alive, so one
  // left running by a throw on a path nobody considered would stop the process
  // exiting. Cleared in `stop()` regardless.
  timer.unref()

  return {
    signal: controller.signal,
    aborted,
    reason: () => reason,
    activity: () => {
      lastActivityAt = Date.now()
    },
    stop: () => clearInterval(timer),
  }
}
