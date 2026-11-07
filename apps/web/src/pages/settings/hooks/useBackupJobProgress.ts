import { useCallback, useEffect, useRef, useState } from 'react'
import { decidePoll, hasLostContact, lostReason, parseSavedRestore, POLL_TIMEOUT_MS, type SavedRestore } from './backupPoll'

/**
 * Polls one backup or restore job.
 *
 * The restore drives the design: it replaces `sessions`, so the admin who started
 * it has no session to poll with. The API hands back a signed token for this job
 * when the restore starts, and polling sends that instead. The token is kept for
 * this tab, because nothing else can pick the job up again: a restore is not in the
 * job list, and during its transaction no session can ask. Rules: backupPoll.ts.
 */

/** Job progress as it arrives over the wire (dates are ISO strings, not Date). */
export interface JobProgress {
  jobId: string
  jobName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt?: string
  currentStep: string
  currentStepIndex: number
  totalSteps: number
  overallProgress: number
  itemsProcessed: number
  itemsTotal: number
  logs: Array<{ timestamp: string; level: string; message: string }>
  error?: string
  result?: Record<string, unknown>
}

export type JobFinishedReason = 'completed' | 'failed' | 'cancelled'

interface Options {
  /** Called once when the job reaches a terminal state. */
  onFinished: (reason: JobFinishedReason, progress: JobProgress) => void
  /** Tracking ended without an outcome. `finishedUnseen`: see `lostReason`. */
  onLost: (reason: ReturnType<typeof lostReason>) => void
}

const POLL_INTERVAL_MS = 1000

const SAVED_RESTORE_KEY = 'aperture-restore-progress'

function saveRestore(saved: SavedRestore | null): void {
  try {
    if (saved) sessionStorage.setItem(SAVED_RESTORE_KEY, JSON.stringify(saved))
    else sessionStorage.removeItem(SAVED_RESTORE_KEY)
  } catch {
    // Storage blocked: the restore still runs, this tab just cannot rejoin it.
  }
}

function readSavedRestore(): SavedRestore | null {
  try {
    return parseSavedRestore(sessionStorage.getItem(SAVED_RESTORE_KEY))
  } catch {
    return null
  }
}

export function useBackupJobProgress({ onFinished, onLost }: Options) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [contactLost, setContactLost] = useState(false)

  const tokenRef = useRef<string | undefined>(undefined)
  const rejoinedUnreadRef = useRef(false)
  const lastAnswerAtRef = useRef(0)
  const pollInFlightRef = useRef(false)

  // In refs so a change of identity does not restart polling.
  const onFinishedRef = useRef(onFinished)
  const onLostRef = useRef(onLost)
  useEffect(() => {
    onFinishedRef.current = onFinished
    onLostRef.current = onLost
  }, [onFinished, onLost])

  const stopTracking = useCallback(() => {
    tokenRef.current = undefined
    saveRestore(null)
    setActiveJobId(null)
    setJobProgress(null)
    setElapsedMs(0)
    setContactLost(false)
  }, [])

  const trackJob = useCallback((jobId: string, progressToken?: string) => {
    tokenRef.current = progressToken
    rejoinedUnreadRef.current = false
    saveRestore(progressToken ? { jobId, token: progressToken } : null)
    setJobProgress(null)
    setElapsedMs(0)
    setContactLost(false)
    setActiveJobId(jobId)
  }, [])

  /** Pick up a restore this tab was watching before the page was left or reloaded. */
  const resumeRestore = useCallback((): boolean => {
    const saved = readSavedRestore()
    if (!saved) return false
    trackJob(saved.jobId, saved.token)
    rejoinedUnreadRef.current = true
    return true
  }, [trackJob])

  /** Take a finished job's panel down, unless another job has started since. */
  const clearFinished = useCallback((jobId: string) => {
    setJobProgress((current) => (current?.jobId === jobId ? null : current))
  }, [])

  const poll = useCallback(async (jobId: string) => {
    const token = tokenRef.current
    let res: Response
    try {
      res = await fetch(`/api/jobs/progress/${jobId}`, {
        credentials: 'include',
        headers: token ? { 'x-job-progress-token': token } : undefined,
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      })
    } catch {
      // A dropped connection says nothing about the job.
      return
    }

    const decision = decidePoll({
      status: res.status,
      isJson: !!res.headers.get('content-type')?.includes('application/json'),
    })
    if (decision === 'wait') return
    if (decision !== 'read') {
      const reason = lostReason(decision, rejoinedUnreadRef.current)
      stopTracking()
      onLostRef.current(reason)
      return
    }

    let data: JobProgress
    try {
      data = (await res.json()) as JobProgress
    } catch {
      return
    }

    lastAnswerAtRef.current = Date.now()
    setContactLost(false)
    rejoinedUnreadRef.current = false
    setJobProgress(data)
    const started = new Date(data.startedAt).getTime()
    if (Number.isFinite(started)) setElapsedMs(Math.max(0, Date.now() - started))

    if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
      tokenRef.current = undefined
      saveRestore(null)
      setActiveJobId(null)
      onFinishedRef.current(data.status, data)
    }
  }, [stopTracking])

  useEffect(() => {
    if (!activeJobId) return
    lastAnswerAtRef.current = Date.now()
    const tick = () => {
      // Judged here rather than from a poll's result: a poll that never returns has none.
      if (hasLostContact(lastAnswerAtRef.current, Date.now())) setContactLost(true)
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      void poll(activeJobId).finally(() => {
        pollInFlightRef.current = false
      })
    }
    tick()
    const interval = window.setInterval(tick, POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [activeJobId, poll])

  return { activeJobId, jobProgress, elapsedMs, contactLost, trackJob, resumeRestore, stopTracking, clearFinished }
}
