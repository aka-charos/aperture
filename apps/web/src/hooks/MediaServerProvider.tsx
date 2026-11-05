/**
 * MediaServerProvider
 *
 * Loads the configured media server type and its capabilities once, so any page can
 * show or hide features that differ between Emby and Jellyfin.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  MediaServerContext,
  type MediaServerCapabilities,
  type MediaServerContextValue,
  type MediaServerKind,
} from './media-server-context'

interface MediaServerProviderProps {
  children: ReactNode
}

interface MediaServerInfoResponse {
  type?: string
  isConfigured?: boolean
  capabilities?: MediaServerCapabilities
}

function toKind(type: string | undefined): MediaServerKind | null {
  return type === 'emby' || type === 'jellyfin' ? type : null
}

export function MediaServerProvider({ children }: MediaServerProviderProps) {
  const [state, setState] = useState<MediaServerContextValue>({
    type: null,
    isConfigured: false,
    capabilities: null,
    loading: true,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch('/api/settings/media-server', { credentials: 'include' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = (await response.json()) as MediaServerInfoResponse
        if (cancelled) return
        setState({
          type: toKind(data.type),
          isConfigured: !!data.isConfigured,
          capabilities: data.capabilities ?? null,
          loading: false,
        })
      } catch {
        // Capabilities stay null (unknown); callers show nothing server-specific.
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }))
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(() => state, [state])

  return <MediaServerContext.Provider value={value}>{children}</MediaServerContext.Provider>
}
