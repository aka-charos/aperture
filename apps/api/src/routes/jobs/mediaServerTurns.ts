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

/** How often a waiting job checks whether it was cancelled. */
export const TURN_CANCEL_POLL_MS = 1_000

interface Waiter {
  jobId: string
  grant: () => void
}

/** A one-at-a-time FIFO whose waiters can leave. */
export class TurnQueue {
  private holder: string | null = null
  private readonly waiting: Waiter[] = []

  constructor(private readonly pollMs = TURN_CANCEL_POLL_MS) {}

  /** Job ids waiting for a turn, in order. */
  waitingJobIds(): string[] {
    return this.waiting.map((w) => w.jobId)
  }

  isWaiting(jobId: string): boolean {
    return this.waiting.some((w) => w.jobId === jobId)
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
      this.holder = jobId
      return Promise.resolve(this.releaseFor(jobId))
    }
    onWait?.()
    return new Promise((resolve) => {
      const waiter: Waiter = {
        jobId,
        grant: () => {
          clearInterval(poll)
          this.holder = jobId
          resolve(this.releaseFor(jobId))
        },
      }
      const poll = setInterval(() => {
        if (!cancelled()) return
        clearInterval(poll)
        const at = this.waiting.indexOf(waiter)
        if (at >= 0) this.waiting.splice(at, 1)
        resolve(null)
      }, this.pollMs)
      this.waiting.push(waiter)
    })
  }

  private releaseFor(jobId: string): () => void {
    let released = false
    return () => {
      // Once, and only by the job that holds the turn.
      if (released || this.holder !== jobId) return
      released = true
      this.holder = null
      this.waiting.shift()?.grant()
    }
  }
}

/** The one queue every media-server job shares, for this process. */
export const mediaServerTurns = new TurnQueue()
