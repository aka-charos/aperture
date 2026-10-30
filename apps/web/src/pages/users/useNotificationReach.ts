import { useEffect, useState } from 'react'

export interface ReachDevice {
  id: string
  model: string | null
  appVersion: string | null
  notificationsAllowed: boolean
  lastSeenAt: string
  signedOut: boolean
}

export interface NotificationReach {
  userId: string
  email: { address: string | null; unreachable: 'noAddress' | 'notAllowed' | 'noAccess' | null }
  emailEvents: string[]
  appEvents: string[]
  devices: ReachDevice[]
}

export interface NotificationReachReport {
  /** False until any phone has ever checked in: the App column stays hidden until then. */
  anyDevices: boolean
  byUser: Map<string, NotificationReach>
}

/** Every account's notification reach, read once for the Users page. Null until read, or if the read fails. */
export function useNotificationReach(): NotificationReachReport | null {
  const [report, setReport] = useState<NotificationReachReport | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/notifications/reach', { credentials: 'include' })
      .then((response) => (response.ok ? (response.json() as Promise<{ anyDevices: boolean; users: NotificationReach[] }>) : null))
      .then((data) => {
        if (cancelled || !data) return
        setReport({ anyDevices: data.anyDevices, byUser: new Map(data.users.map((entry) => [entry.userId, entry])) })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return report
}
