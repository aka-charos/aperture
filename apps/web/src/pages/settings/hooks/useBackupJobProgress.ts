import { useCallback, useEffect, useRef, useState } from 'react'
import { decidePoll } from './backupPoll'

/**
 * Polls one backup or restore job.
 *
 * The restore drives the design: it replaces `sessions`, so the admin who started
 * it has no session to poll with. The API hands back a signed token for this job
 * when the restore starts, and polling sends that instead. Rules: backupPoll.ts.
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
  /** Tracking ended without an outcome: refused with no token, or the job is gone. */
  onLost: (reason: 'authLost' | 'gone') => void
}

const POLL_INTERVAL_MS = 1000

export function useBackupJobProgress({ onFinished, onLost }: Options) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  const tokenRef = useRef<string | undefined>(undefined)

  // In refs so a change of identity does not restart polling.
  const onFinishedRef = useRef(onFinished)
  const onLostRef = useRef(onLost)
  useEffect(() => {
    onFinishedRef.current = onFinished
    onLostRef.current = onLost
  }, [onFinished, onLost])

  const stopTracking = useCallback(() => {
    tokenRef.current = undefined
    setActiveJobId(null)
    setJobProgress(null)
    setElapsedMs(0)
  }, [])

  const trackJob = useCallback((jobId: string, progressToken?: string) => {
    tokenRef.current = progressToken
    setJobProgress(null)
    setElapsedMs(0)
    setActiveJobId(jobId)
  }, [])

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
      })
    } catch {
      // A dropped connection says nothing about the job.
      return
    }

    const decision = decidePoll({
      status: res.status,
      hasToken: !!token,
      isJson: !!res.headers.get('content-type')?.includes('application/json'),
    })
    if (decision === 'wait') return
    if (decision !== 'read') {
      stopTracking()
      onLostRef.current(decision)
      return
    }

    let data: JobProgress
    try {
      data = (await res.json()) as JobProgress
    } catch {
      return
    }

    setJobProgress(data)
    const started = new Date(data.startedAt).getTime()
    if (Number.isFinite(started)) setElapsedMs(Math.max(0, Date.now() - started))

    if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
      tokenRef.current = undefined
      setActiveJobId(null)
      onFinishedRef.current(data.status, data)
    }
  }, [stopTracking])

  useEffect(() => {
    if (!activeJobId) return
    void poll(activeJobId)
    const interval = window.setInterval(() => void poll(activeJobId), POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [activeJobId, poll])

  return { activeJobId, jobProgress, elapsedMs, trackJob, stopTracking, clearFinished }
}
