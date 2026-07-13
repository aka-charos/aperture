import { useEffect, useState } from 'react'

/**
 * Server display name for UI text ("Not on your <name>", etc.).
 *
 * Resolved from /api/settings/media-server `displayName`, which is the
 * admin-configured name (Settings → Media Server) falling back to the name
 * reported by the media server itself. Returns null while loading or when
 * no name is available — callers should fall back to a generic string.
 *
 * Fetched once per app session (module-level cache shared by all callers).
 */

let cached: Promise<string | null> | null = null

function fetchServerDisplayName(): Promise<string | null> {
  if (!cached) {
    cached = fetch('/api/settings/media-server', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { displayName?: string } | null) => {
        const name = data?.displayName?.trim()
        return name ? name : null
      })
      .catch(() => {
        cached = null
        return null
      })
  }
  return cached
}

export function useServerDisplayName(): string | null {
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchServerDisplayName().then((value) => {
      if (!cancelled) setName(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return name
}
