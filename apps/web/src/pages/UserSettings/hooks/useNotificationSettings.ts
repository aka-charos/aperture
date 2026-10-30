import { useCallback, useEffect, useState } from 'react'

/** An event name as the server sends it; the server's list, in its order, is the only one. */
export type NotificationEvent = string

export interface NotificationPreference {
  event: NotificationEvent
  email: boolean
  app: boolean
}

export interface NotificationDevice {
  id: string
  model: string | null
  androidVersion: string | null
  appVersion: string | null
  notificationsAllowed: boolean
  firstSeenAt: string
  lastSeenAt: string
  /** Decided by the server: past the sign-in lifetime, so this phone receives nothing. */
  signedOut: boolean
}

export interface NotificationSettings {
  preferences: NotificationPreference[]
  /** Decided by the server (core notifications/rules.ts `emailReachability`). */
  email: { reachable: boolean; reason: 'noAddress' | 'notAllowed' | 'noAccess' | null }
  devices: NotificationDevice[]
}

async function readSettings(response: Response): Promise<NotificationSettings> {
  if (!response.ok) throw new Error(String(response.status))
  return (await response.json()) as NotificationSettings
}

/**
 * The signed-in person's notification choices and phones. A change shows at
 * once and is put back if the server refuses it; the server's answer then
 * replaces the whole state, since it is the one copy of what was stored.
 */
export function useNotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    try {
      setSettings(await readSettings(await fetch('/api/notifications/preferences', { credentials: 'include' })))
    } catch {
      setSettings(null)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const setChannel = useCallback(
    async (event: NotificationEvent, channel: 'email' | 'app', value: boolean) => {
      if (!settings) return
      const previous = settings
      const current = settings.preferences.find((p) => p.event === event)
      if (!current) return
      const next = { ...current, [channel]: value }
      setSettings({ ...settings, preferences: settings.preferences.map((p) => (p.event === event ? next : p)) })
      setSaving(true)
      setError(false)
      try {
        const response = await fetch('/api/notifications/preferences', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: [next] }),
        })
        setSettings(await readSettings(response))
      } catch {
        setSettings(previous)
        setError(true)
      } finally {
        setSaving(false)
      }
    },
    [settings]
  )

  const removeDevice = useCallback(
    async (id: string) => {
      setError(false)
      try {
        const response = await fetch(`/api/notifications/devices/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!response.ok && response.status !== 404) throw new Error(String(response.status))
        await reload()
      } catch {
        setError(true)
      }
    },
    [reload]
  )

  /** Shown to someone email can reach (or could, once they add an address) or who has the app. */
  const offered =
    settings != null &&
    (settings.devices.length > 0 || (settings.email.reason !== 'notAllowed' && settings.email.reason !== 'noAccess'))

  return {
    settings,
    loaded,
    offered,
    saving,
    error,
    setChannel,
    removeDevice,
    reload,
    dismissError: () => setError(false),
  }
}
