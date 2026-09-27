import { useEffect, useState } from 'react'

export interface ConnectionRecentWatchItem {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  lastWatched: string
  playCount: number
  lastEpisode?: { seasonNumber: number; episodeNumber: number }
}

export interface ConnectionRecentWatches {
  user: { id: string; name: string; avatarUrl: string }
  items: ConnectionRecentWatchItem[]
}

/**
 * What the viewer's connections watched lately, one entry per connection
 * (GET /api/social/recent-watches). Deliberately its own request rather than
 * fields on /api/dashboard: most viewers have no connections and fetch nothing.
 */
export function useConnectionsRecentWatches(enabled: boolean) {
  const [users, setUsers] = useState<ConnectionRecentWatches[]>([])
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setUsers([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch('/api/social/recent-watches', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = (await response.json()) as { users?: ConnectionRecentWatches[] }
        if (!cancelled) setUsers(data.users ?? [])
      })
      .catch((err) => {
        // No sliders is the quiet failure; the viewer's own rows are unaffected.
        console.error("Failed to fetch connections' recent watches:", err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { users, loading }
}
