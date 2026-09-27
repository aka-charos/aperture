/**
 * ConnectionsProvider
 *
 * The viewer's connections and how many titles are waiting for them under
 * Shared with me (the sidebar badge). Connections are made by an admin and are
 * mutual; see docs/plans/social-connections.md.
 *
 * Gated on the server's decided `social` capability: someone with no
 * connections — most people — fetches nothing at all. The badge count is
 * refetched when the window regains focus, at most once a minute, so something
 * sent while this tab was open shows up without a reload.
 *
 * No localStorage cache: an assumed session starts and stops with a full page
 * load anyway, and a stale badge is a wrong claim on first paint.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ConnectionsContext, type ConnectionSummary } from './connections-context'
import { useCapability } from './useCapability'

const FOCUS_REFRESH_MS = 60_000

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return (await response.json()) as T
}

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const enabled = useCapability('social')
  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(enabled)
  const lastCountAt = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadCount = useCallback(async () => {
    lastCountAt.current = Date.now()
    try {
      const data = await fetchJson<{ count?: number }>('/api/social/recommendations/count')
      if (mounted.current) setPendingCount(typeof data.count === 'number' ? data.count : 0)
    } catch (err) {
      // A badge that fails to load shows nothing, which is the quiet direction.
      console.error('Failed to fetch the shared-with-me count:', err)
    }
  }, [])

  const loadConnections = useCallback(async () => {
    try {
      const data = await fetchJson<{ connections?: ConnectionSummary[] }>('/api/social/connections')
      if (mounted.current) setConnections(data.connections ?? [])
    } catch (err) {
      console.error('Failed to fetch connections:', err)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled) return
    await Promise.all([loadConnections(), loadCount()])
  }, [enabled, loadConnections, loadCount])

  useEffect(() => {
    if (!enabled) {
      setConnections([])
      setPendingCount(0)
      setLoading(false)
      return
    }
    setLoading(true)
    refresh().finally(() => {
      if (mounted.current) setLoading(false)
    })
  }, [enabled, refresh])

  useEffect(() => {
    if (!enabled) return
    const onFocus = () => {
      if (Date.now() - lastCountAt.current >= FOCUS_REFRESH_MS) void loadCount()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, loadCount])

  const value = useMemo(
    () => ({
      enabled,
      connections,
      pendingCount,
      loading,
      hasConnections: enabled && (loading || connections.length > 0),
      refresh,
    }),
    [enabled, connections, pendingCount, loading, refresh]
  )

  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>
}
