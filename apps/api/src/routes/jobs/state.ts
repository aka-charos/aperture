/**
 * Jobs Shared State
 *
 * `activeJobs` maps a job NAME to the id of the run currently occupying it.
 * Membership means "the work is still in flight" and nothing else: the entry is
 * set before runJob starts and cleared by its finally, so it outlives a
 * cancellation for exactly as long as the work does.
 *
 * (Not to be confused with the map of the same name in core's jobs/progress.ts,
 * which is keyed by job ID and holds live progress records.)
 */

import { getJobProgress, type JobProgress } from '@aperture/core'

export const activeJobs: Map<string, string> = new Map()

export type ClaimDecision = { ok: true } | { ok: false; cancelling: boolean }
export type ClaimResult = { ok: true } | { ok: false; jobId: string; cancelling: boolean }

/**
 * Whether a job slot may be taken, given who holds it and what state that
 * holder is in. Pure, and split from the map mutation for the same reason as
 * watchedExclusion.ts and pending.ts: the bug this fixes was a wrong predicate,
 * and a predicate nothing can test is how it survived.
 *
 * Three callers kept a hand-written copy -- the Run button, the scheduler and
 * gap analysis -- and all three asked `status === 'running'`, which a CANCELLED
 * job does not satisfy. Cancellation is cooperative, so a cancelled job keeps
 * working until its own loop next polls isJobCancelled; asking about the status
 * therefore admitted a second run beside the first. Measured live: one
 * cancelled recommendations run scored all nine users alongside its own
 * replacement -- 18 runs in 13 minutes, double the explanation spend, with
 * job_runs recording only one of them because completeJob on an
 * already-terminal job is ignored.
 *
 * The right question is whether anyone holds the slot at all. The status is
 * still read, but only to say WHY it is busy.
 *
 * @param holderJobId    id currently occupying the name, if any
 * @param holderStatus   the holder's progress status; undefined when the record
 *                       has been evicted, which progress.ts does five minutes
 *                       after any terminal status. That is the escape hatch for
 *                       a run that hung or whose loop never polls, and it is
 *                       deliberately bounded -- for those five minutes the slot
 *                       stays held, which is the entire point.
 */
export function decideClaim(
  holderJobId: string | undefined,
  holderStatus: JobProgress['status'] | undefined
): ClaimDecision {
  if (!holderJobId) return { ok: true }
  if (!holderStatus) return { ok: true }
  return { ok: false, cancelling: holderStatus === 'cancelled' }
}

/** Take the slot for a job name, or report who is holding it. */
export function claimJob(name: string, jobId: string): ClaimResult {
  const holder = activeJobs.get(name)
  const decision = decideClaim(holder, holder ? getJobProgress(holder)?.status : undefined)

  if (!decision.ok) {
    return { ok: false, jobId: holder as string, cancelling: decision.cancelling }
  }

  activeJobs.set(name, jobId)
  return { ok: true }
}

/**
 * Release the slot, but only if it is still ours.
 *
 * A cancelled job that kept running exits AFTER its replacement has claimed the
 * name, and an unconditional delete would open the guard on a run that is still
 * going -- turning one double-run into two.
 */
export function releaseJob(name: string, jobId: string): void {
  if (activeJobs.get(name) === jobId) activeJobs.delete(name)
}
