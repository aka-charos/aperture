import { useEffect, useState } from 'react'

/**
 * One poll of `/api/jobs/active`, shared by everything that needs to know what
 * is running.
 *
 * `RunningJobsWidget` already polled this every two seconds for every admin on
 * every page, and the old admin tab strip polled it a second time at three
 * seconds to put a count on its Jobs tab. Two pollers for one fact. This is the
 * one poller: the widget reads it for its progress bar, and the console's nav
 * column reads it to badge the Jobs entry, at no extra cost in requests.
 *
 * Module-level rather than a context provider because the consumers sit in
 * different parts of the tree (the app bar and the admin content pane) and
 * neither should have to care whether a provider is above it. The interval is
 * reference-counted, so it runs only while something is listening.
 */

export interface JobProgress {
  jobId: string
  jobName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt?: string
  currentStep: string
  currentStepIndex: number
  totalSteps: number
  stepProgress: number
  overallProgress: number
  itemsProcessed: number
  itemsTotal: number
  currentItem?: string
  error?: string
}

const POLL_MS = 2000

type Listener = (jobs: JobProgress[]) => void

const listeners = new Set<Listener>()
let timer: ReturnType<typeof setInterval> | null = null
let latest: JobProgress[] = []

async function poll(): Promise<void> {
  try {
    const response = await fetch('/api/jobs/active', { credentials: 'include' })
    if (!response.ok) return
    const data = (await response.json()) as { jobs?: JobProgress[] }
    // The last subscriber can leave while this request is in flight. Writing
    // anyway would refill the cache the cleanup had just emptied, and the next
    // consumer to mount would open on a list from a previous visit.
    if (listeners.size === 0) return
    latest = data.jobs ?? []
    for (const listener of listeners) listener(latest)
  } catch {
    // A failed poll keeps the last known list rather than blanking the widget:
    // one dropped request is not evidence that the jobs stopped.
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  // Hand the newcomer what we already know, so a second consumer mounting
  // mid-cycle does not sit empty until the next tick.
  if (latest.length) listener(latest)

  if (timer === null) {
    void poll()
    timer = setInterval(() => void poll(), POLL_MS)
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
      // Dropped too: a list from before the last unmount is stale by the time
      // anything subscribes again.
      latest = []
    }
  }
}

/**
 * `enabled` is the caller's admin check. Passing false subscribes to nothing,
 * so a non-admin session never starts the interval.
 */
export function useActiveJobs(enabled: boolean): JobProgress[] {
  const [jobs, setJobs] = useState<JobProgress[]>([])

  useEffect(() => {
    if (!enabled) {
      setJobs([])
      return
    }
    return subscribe(setJobs)
  }, [enabled])

  return jobs
}

/** How many jobs are running right now. */
export function countRunning(jobs: JobProgress[]): number {
  return jobs.filter((job) => job.status === 'running').length
}
