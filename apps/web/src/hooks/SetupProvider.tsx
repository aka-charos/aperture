import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { answerIsDatabaseRestoring, DATABASE_RESTORE_RETRY_MS } from '@/lib/databaseRestoring'
import { SetupContext, type SetupStatus } from './setup-context'

export function SetupProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refreshRef = useRef<() => Promise<void>>(async () => {})

  const refresh = useCallback(async () => {
    let waiting = false
    try {
      setError(null)
      const response = await fetch('/api/setup/status', {
        credentials: 'include',
      })

      // Whether setup is needed depends on what the restore leaves: ask again.
      if (await answerIsDatabaseRestoring(response)) {
        waiting = true
        window.setTimeout(() => void refreshRef.current(), DATABASE_RESTORE_RETRY_MS)
        return
      }

      if (response.ok) {
        const data = await response.json()
        setStatus(data)
      } else {
        setError('Failed to check setup status')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check setup status')
    } finally {
      if (!waiting) setLoading(false)
    }
  }, [])
  refreshRef.current = refresh

  useEffect(() => {
    refresh()
  }, [refresh])

  const markComplete = useCallback(() => {
    setStatus(prev => prev ? { ...prev, needsSetup: false, canAccessSetup: prev.isAdmin } : null)
  }, [])

  return (
    <SetupContext.Provider value={{ status, loading, error, refresh, markComplete }}>
      {children}
    </SetupContext.Provider>
  )
}
