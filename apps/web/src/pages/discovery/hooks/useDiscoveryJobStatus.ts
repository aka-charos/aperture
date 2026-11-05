import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useActiveJobs, type JobProgress } from '../../../hooks/activeJobs'

const DISCOVERY_JOB_NAME = 'generate-discovery-suggestions'

interface UseDiscoveryJobStatusOptions {
  onComplete?: () => void
}

/**
 * Follows the suggestions job for an admin. `/api/jobs/active` is admin-only, so
 * nobody else has anything to ask; admins already have the shared poll.
 */
export function useDiscoveryJobStatus(options: UseDiscoveryJobStatusOptions = {}) {
  const { onComplete } = options
  const { user } = useAuth()
  const jobs = useActiveJobs(Boolean(user?.isAdmin))
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const onCompleteRef = useRef(onComplete)

  // Keep onComplete ref up to date
  onCompleteRef.current = onComplete

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  const subscribeToJobProgress = useCallback((jobId: string) => {
    // Close existing connection if any
    closeEventSource()

    const eventSource = new EventSource(`/api/jobs/progress/stream/${jobId}`, {
      withCredentials: true,
    })

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as JobProgress
        setProgress(data)

        // Check if job finished
        if (
          data.status === 'completed' ||
          data.status === 'failed' ||
          data.status === 'cancelled'
        ) {
          // Small delay before calling onComplete to let UI show final state
          setTimeout(() => {
            setIsRunning(false)
            setProgress(null)
            closeEventSource()

            // Only call onComplete for successful completion
            if (data.status === 'completed' && onCompleteRef.current) {
              onCompleteRef.current()
            }
          }, 1000)
        }
      } catch (err) {
        console.error('Failed to parse job progress:', err)
      }
    }

    eventSource.onerror = () => {
      // Connection error - close and let polling pick up again
      closeEventSource()
      setIsRunning(false)
      setProgress(null)
    }

    eventSourceRef.current = eventSource
  }, [closeEventSource])

  useEffect(() => {
    const discoveryJob = jobs.find(
      (job) => job.jobName === DISCOVERY_JOB_NAME && job.status === 'running'
    )

    if (discoveryJob) {
      setIsRunning(true)
      setProgress(discoveryJob)
      if (!eventSourceRef.current) subscribeToJobProgress(discoveryJob.jobId)
    } else if (!eventSourceRef.current) {
      // An open stream reports the end itself, and that report is what refreshes
      // the list. Only without one does a poll get to say the job has stopped.
      setIsRunning(false)
      setProgress(null)
    }
  }, [jobs, subscribeToJobProgress])

  useEffect(() => closeEventSource, [closeEventSource])

  return {
    isRunning,
    progress,
  }
}
