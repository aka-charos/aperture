/**
 * MediaServerProvider
 *
 * Loads the configured media server type and its capabilities once, so any page can
 * show or hide features that differ between Emby and Jellyfin.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_MEDIA_SERVER_CAPABILITIES,
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
  capabilities?: Partial<MediaServerCapabilities>
}

function toKind(type: string | undefined): MediaServerKind | null {
  return type === 'emby' || type === 'jellyfin' ? type : null
}

export function MediaServerProvider({ children }: MediaServerProviderProps) {
  const [state, setState] = useState<MediaServerContextValue>({
    type: null,
    isConfigured: false,
    capabilities: DEFAULT_MEDIA_SERVER_CAPABILITIES,
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
          capabilities: { ...DEFAULT_MEDIA_SERVER_CAPABILITIES, ...data.capabilities },
          loading: false,
        })
      } catch {
        // Keep the permissive defaults: failing to load must not hide features.
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
