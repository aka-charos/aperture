/**
 * The jobs that work the media server hard take turns, one at a time.
 *
 * Each sync or publishing job reads (or writes) the whole library, every user,
 * or every viewer's home rows. Started together, on the hour or by an admin
 * pressing several Run buttons, they asked the server for all of it at once;
 * upstream found Emby becoming unresponsive under that (1.0.1, `e44278d2`).
 * The per-request cap (`media/serverRequest.ts`) limits requests in flight,
 * not whole jobs, so it spreads the same total load over the same minutes.
 *
 * A job waiting its turn holds its own name in `activeJobs` (a second Run of
 * it is refused as already running, the scheduler's next firing too) and can
 * be cancelled while it waits: it then leaves the queue at once.
 *
 * Not in the list: the recommendation and discovery jobs, which read the
 * server only briefly and then spend minutes or hours on models, and would
 * hold every sync behind them; and anything that reads it once.
 */

import { createChildLogger } from '@aperture/core'

const logger = createChildLogger('media-server-turns')

export const MEDIA_SERVER_JOBS: ReadonlySet<string> = new Set([
  'sync-users',
  'sync-movies',
  'sync-series',
  'sync-movie-watch-history',
  'sync-series-watch-history',
  'sync-watching-favorites',
  'sync-home-sections',
  'sync-movie-libraries',
  'sync-series-libraries',
  'refresh-top-picks',
  'remove-legacy-libraries',
])

/** How often a waiting job checks whether it, or the holder, should give way. */
export const TURN_CANCEL_POLL_MS = 1_000

/**
 * How long one job may keep the turn while others wait. Past it the turn
 * passes on and the two run side by side, as every job did before turns:
 * a stuck job (cancellation is cooperative, so Stop cannot end one that
 * never polls) must not stop user sync and every other sync for good.
 * Generous, because a full library sync of a large library is long; the
 * cost of passing on early is only the old overlap.
 */
export const TURN_LEASE_MS = 90 * 60 * 1000

/** Why a turn passed on before its holder released it. */
export type TurnOverride = 'cancelled' | 'lease'

interface Waiter {
  jobId: string
  cancelled: () => boolean
  grant: () => void
  /** Leaves the queue without the turn (cancelled). */
  drop: () => void
}

interface Holder {
  jobId: string
  cancelled: () => boolean
  since: number
}

/**
 * A one-at-a-time FIFO whose waiters can leave, and whose holder gives way
 * when it is cancelled (it is only winding down) or has held the turn past
 * the lease.
 */
export class TurnQueue {
  private holder: Holder | null = null
  private readonly waiting: Waiter[] = []

  constructor(
    private readonly options: {
      pollMs?: number
      leaseMs?: number
      now?: () => number
      /** Told when a turn passes on before its holder released it. */
      onOverride?: (holderJobId: string, reason: TurnOverride) => void
    } = {}
  ) {}

  private get pollMs(): number {
    return this.options.pollMs ?? TURN_CANCEL_POLL_MS
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  /**
   * Waits for the turn. Resolves with a release function, or null when
   * `cancelled()` turned true while waiting (the job then never starts).
   * `onWait` runs only when the job has to wait, so a job that goes straight
   * in shows no waiting state.
   */
  acquire(
    jobId: string,
    cancelled: () => boolean,
    onWait?: () => void
  ): Promise<(() => void) | null> {
    if (this.holder === null) {
      this.take(jobId, cancelled)
      return Promise.resolve(this.releaseFor(jobId))
    }
    onWait?.()
    return new Promise((resolve) => {
      const waiter: Waiter = {
        jobId,
        cancelled,
        grant: () => {
          clearInterval(poll)
          this.take(jobId, cancelled)
          resolve(this.releaseFor(jobId))
        },
        drop: () => {
          clearInterval(poll)
          resolve(null)
        },
      }
      // The poll lets a cancelled job leave early and checks the holder's
      // lease; the hand-over asks about cancellation again, since a cancel
      // can land between two polls.
      const poll = setInterval(() => {
        if (cancelled()) {
          const at = this.waiting.indexOf(waiter)
          if (at >= 0) this.waiting.splice(at, 1)
          waiter.drop()
          return
        }
        this.checkHolder()
      }, this.pollMs)
      this.waiting.push(waiter)
    })
  }

  private take(jobId: string, cancelled: () => boolean): void {
    this.holder = { jobId, cancelled, since: this.now() }
  }

  /** Passes the turn on from a holder that was cancelled or has held it too long. */
  private checkHolder(): void {
    const holder = this.holder
    if (!holder) return
    const reason: TurnOverride | null = holder.cancelled()
      ? 'cancelled'
      : this.now() - holder.since >= (this.options.leaseMs ?? TURN_LEASE_MS)
        ? 'lease'
        : null
    if (!reason) return
    this.options.onOverride?.(holder.jobId, reason)
    // Its own release becomes a no-op: it no longer holds the turn.
    this.holder = null
    this.handOver()
  }

  private releaseFor(jobId: string): () => void {
    let released = false
    return () => {
      // Once, and only by the job that holds the turn.
      if (released || this.holder?.jobId !== jobId) return
      released = true
      this.holder = null
      this.handOver()
    }
  }

  /** The turn goes to the first waiter still wanting it; cancelled ones leave. */
  private handOver(): void {
    for (let next = this.waiting.shift(); next; next = this.waiting.shift()) {
      if (next.cancelled()) {
        next.drop()
        continue
      }
      next.grant()
      return
    }
  }
}

/** The one queue every media-server job shares, for this process. */
export const mediaServerTurns = new TurnQueue({
  onOverride: (jobId, reason) =>
    logger.warn(
      { jobId, reason },
      reason === 'lease'
        ? `A media-server job has held its turn for over ${TURN_LEASE_MS / 60_000} minutes; the next one starts beside it`
        : 'A cancelled media-server job is still winding down; the next one starts beside it'
    ),
})

/** The step a waiting job shows. */
export const WAITING_STEP = 'Waiting for another media-server job to finish'

/** What runInTurn needs from the job system, passed in so it can be tested without one. */
export interface TurnDeps<R extends { status: string }> {
  turns: TurnQueue
  isCancelled: (jobId: string) => boolean
  /** Record for a job that must wait (shows Queued, cancellable). */
  createQueued: (jobId: string, name: string, step: string) => R
  /** The job's turn came: no longer Queued. */
  startQueued: (jobId: string) => void
  /** The live record for a job, to tell whether the job replaced ours. */
  current: (jobId: string) => R | undefined
  complete: (jobId: string) => void
  /** Frees the job's name in activeJobs. */
  releaseSlot: (name: string, jobId: string) => void
  log: (message: string) => void
}

/**
 * Runs a media-server job when its turn comes. A job that has to wait gets a
 * progress record first, so it shows as Queued and can be cancelled before it
 * starts; one cancelled while waiting never runs and frees its name.
 */
export async function runInTurn<R extends { status: string }>(
  name: string,
  jobId: string,
  run: () => Promise<void>,
  deps: TurnDeps<R>
): Promise<void> {
  // An object, so the record set inside the callback is seen after it.
  const waiting: { record?: R } = {}
  const release = await deps.turns.acquire(
    jobId,
    () => deps.isCancelled(jobId),
    () => {
      waiting.record = deps.createQueued(jobId, name, WAITING_STEP)
      deps.log(`⏳ ${name} waits for another media-server job`)
    }
  )
  // A cancel can also land after the hand-over and before this line.
  if (!release || deps.isCancelled(jobId)) {
    release?.()
    // cancelJob already recorded the run; it never started.
    deps.log(`🛑 ${name} cancelled before its turn`)
    deps.releaseSlot(name, jobId)
    return
  }
  if (waiting.record) deps.startQueued(jobId)
  try {
    await run()
  } finally {
    release()
    // A job whose function keeps no progress record of its own would leave
    // the waiting record running for ever; close it.
    const record = deps.current(jobId)
    if (waiting.record && record === waiting.record && record.status === 'running') {
      deps.complete(jobId)
    }
  }
}
