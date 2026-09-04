import { useEffect, useState, useRef, useCallback } from 'react'
import type { Job, JobProgress, ScheduleType } from '../types'

export interface UpdateJobConfigParams {
  scheduleType?: ScheduleType
  scheduleHour?: number | null
  scheduleMinute?: number | null
  scheduleDayOfWeek?: number | null
  scheduleDaysOfWeek?: number[] | null
  scheduleIntervalHours?: number | null
  scheduleIntervalMinutes?: number | null
  isEnabled?: boolean
}

export interface UseJobsDataReturn {
  jobs: Job[]
  loading: boolean
  error: string | null
  jobProgress: Map<string, JobProgress>
  expandedLogs: Set<string>
  cancelDialogJob: string | null
  cancellingJobs: Set<string>
  logsContainerRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  runningCount: number
  handleRunJob: (jobName: string) => Promise<void>
  handleCancelJob: (jobName: string) => Promise<void>
  handleUpdateConfig: (jobName: string, config: UpdateJobConfigParams) => Promise<void>
  toggleLogs: (jobName: string) => void
  /** Idempotent, unlike `toggleLogs` — see the note at the implementation. */
  expandLogs: (jobName: string) => void
  setCancelDialogJob: (jobName: string | null) => void
}

export function useJobsData(): UseJobsDataReturn {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [jobProgress, setJobProgress] = useState<Map<string, JobProgress>>(new Map())
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  const [cancelDialogJob, setCancelDialogJob] = useState<string | null>(null)
  const [cancellingJobs, setCancellingJobs] = useState<Set<string>>(new Set())
  const logsContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const eventSourceRefs = useRef<Map<string, EventSource>>(new Map())

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setJobs(data.jobs)
        setError(null)
        return data.jobs as Job[]
      } else {
        setError('Failed to load jobs')
      }
    } catch {
      setError('Could not connect to server')
    } finally {
      setLoading(false)
    }
    return []
  }, [])

  const connectToJobStream = useCallback(
    (jobName: string, jobId: string) => {
      const existing = eventSourceRefs.current.get(jobId)
      if (existing) {
        existing.close()
      }

      const eventSource = new EventSource(`/api/jobs/progress/stream/${jobId}`, {
        withCredentials: true,
      })

      eventSource.onmessage = (event) => {
        try {
          const progress = JSON.parse(event.data) as JobProgress
          setJobProgress((prev) => {
            const next = new Map(prev)
            next.set(jobName, progress)
            return next
          })

          // Auto-scroll logs
          setTimeout(() => {
            const container = logsContainerRefs.current.get(jobName)
            if (container) {
              container.scrollTop = container.scrollHeight
            }
          }, 100)

          // If job finished, refresh and clear progress after delay
          if (
            progress.status === 'completed' ||
            progress.status === 'failed' ||
            progress.status === 'cancelled'
          ) {
            setTimeout(() => {
              fetchJobs()
              setTimeout(() => {
                setJobProgress((prev) => {
                  const next = new Map(prev)
                  next.delete(jobName)
                  return next
                })
              }, 5000)
            }, 1000)
          }
        } catch (err) {
          console.error('Failed to parse progress:', err)
        }
      }

      eventSource.onerror = () => {
        eventSource.close()
        eventSourceRefs.current.delete(jobId)
      }

      eventSourceRefs.current.set(jobId, eventSource)
    },
    [fetchJobs]
  )

  useEffect(() => {
    const init = async () => {
      const loadedJobs = await fetchJobs()
      loadedJobs.forEach((job: Job) => {
        if (job.status === 'running' && job.currentJobId) {
          if (!eventSourceRefs.current.has(job.currentJobId)) {
            connectToJobStream(job.name, job.currentJobId)
          }
        }
      })
    }
    init()

    const interval = setInterval(async () => {
      const loadedJobs = await fetchJobs()
      loadedJobs.forEach((job: Job) => {
        if (job.status === 'running' && job.currentJobId) {
          if (!eventSourceRefs.current.has(job.currentJobId)) {
            connectToJobStream(job.name, job.currentJobId)
          }
        }
      })
    }, 10000)

    const eventSources = eventSourceRefs.current
    return () => {
      clearInterval(interval)
      eventSources.forEach((es) => es.close())
    }
  }, [fetchJobs, connectToJobStream])

  const handleRunJob = async (jobName: string) => {
    try {
      const response = await fetch(`/api/jobs/${jobName}/run`, {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        // A 409 is the EXPECTED answer for a short window after cancelling: a
        // cancelled job holds its slot until the work actually stops, and the
        // message says which of the two it is. Swallowing it left the Run
        // button looking dead, which is what sends an operator to `docker
        // stop` -- the exact move that produced the double-run the guard
        // exists to prevent. The server's own wording is the whole value here,
        // so it is shown rather than replaced.
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error || `Failed to start ${jobName}`)
        return
      }

      setError(null)
      const data = await response.json()
      connectToJobStream(jobName, data.jobId)
      await fetchJobs()
    } catch (err) {
      console.error('Failed to run job:', err)
      setError('Could not connect to server')
    }
  }

  const handleCancelJob = async (jobName: string) => {
    setCancelDialogJob(null)
    setCancellingJobs((prev) => new Set(prev).add(jobName))

    try {
      const response = await fetch(`/api/jobs/${jobName}/cancel`, {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        // Same reasoning as the Run button: "No active job to cancel" is a
        // real answer and the operator needs to see it rather than watch
        // nothing happen.
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error || `Failed to cancel ${jobName}`)
        return
      }

      await fetchJobs()
    } catch (err) {
      console.error('Failed to cancel job:', err)
      setError('Could not connect to server')
    } finally {
      setCancellingJobs((prev) => {
        const next = new Set(prev)
        next.delete(jobName)
        return next
      })
    }
  }

  const toggleLogs = (jobName: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev)
      if (next.has(jobName)) {
        next.delete(jobName)
      } else {
        next.add(jobName)
      }
      return next
    })
  }

  /**
   * Opens a job's logs without closing them if they are already open.
   *
   * Arriving from the app bar's progress widget means "show me what this is
   * doing", and a toggle would close the logs of anyone who had already opened
   * them — including on a second click of the same link, which is the natural
   * thing to do when the first one did not seem to work.
   */
  const expandLogs = (jobName: string) => {
    setExpandedLogs((prev) => (prev.has(jobName) ? prev : new Set(prev).add(jobName)))
  }

  const handleUpdateConfig = async (jobName: string, config: UpdateJobConfigParams) => {
    const response = await fetch(`/api/jobs/${jobName}/config`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    })

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
        message?: string
      }
      throw new Error(data.message || data.error || 'Failed to update job configuration')
    }

    // Refresh jobs to get updated schedule
    await fetchJobs()
  }

  const runningCount = jobs.filter((j) => j.status === 'running').length

  return {
    jobs,
    loading,
    error,
    jobProgress,
    expandedLogs,
    cancelDialogJob,
    cancellingJobs,
    logsContainerRefs,
    runningCount,
    handleRunJob,
    handleCancelJob,
    handleUpdateConfig,
    toggleLogs,
    expandLogs,
    setCancelDialogJob,
  }
}

