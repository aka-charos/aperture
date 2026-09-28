/**
 * ConnectionsProvider
 *
 * The viewer's connections and how many titles are waiting for them under
 * Shared with me (the sidebar badge). Connections are made by an admin and are
 * mutual; see docs/plans/social-connections.md.
 *
 * Gated on the server's decided `social` capability: someone with no
 * connections — most people — fetches nothing social at all.
 *
 * Connections are made by an admin while the other person may already be
 * signed in, and `social` is decided at page load, so without a re-check a
 * newly connected person saw nothing until they reloaded. When the window
 * regains focus (at most once a minute) the capability is re-read for everyone
 * — one cheap auth check — and, for someone already connected, the connection
 * list and the badge count too. The admin dialog also re-reads it the moment it
 * changes a pair, which covers an admin connecting themselves.
 *
 * No localStorage cache: an assumed session starts and stops with a full page
 * load anyway, and a stale badge is a wrong claim on first paint.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ConnectionsContext, type ConnectionSummary } from './connections-context'
import { useCapability } from './useCapability'
import { useAuth } from './useAuth'

const FOCUS_REFRESH_MS = 60_000

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return (await response.json()) as T
}

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const enabled = useCapability('social')
  const { refreshCapabilities } = useAuth()
  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(enabled)
  const lastRefreshAt = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadCount = useCallback(async () => {
    lastRefreshAt.current = Date.now()
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
    const onFocus = () => {
      if (Date.now() - lastRefreshAt.current < FOCUS_REFRESH_MS) return
      lastRefreshAt.current = Date.now()
      // A change of `social` re-runs the effect above, which loads everything;
      // while it holds, the list and the badge are refreshed here.
      void refreshCapabilities()
      if (enabled) void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, refresh, refreshCapabilities])

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
