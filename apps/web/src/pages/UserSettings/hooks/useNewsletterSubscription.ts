import { useCallback, useEffect, useState } from 'react'

export interface NewsletterSubscription {
  optedIn: boolean
  hasAddress: boolean
  /** Decided by the server: whether this instance can send a newsletter at all. */
  available: boolean
}

/**
 * The signed-in person's own newsletter choice. Read once per page; a save
 * shows the new value at once and puts the old one back if the server refuses.
 */
export function useNewsletterSubscription() {
  const [subscription, setSubscription] = useState<NewsletterSubscription | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/newsletter/subscription', { credentials: 'include' })
      .then((response) => (response.ok ? (response.json() as Promise<NewsletterSubscription>) : null))
      .then((data) => {
        if (cancelled) return
        setSubscription(data)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setOptedIn = useCallback(
    async (optedIn: boolean) => {
      if (!subscription) return
      const previous = subscription
      setSubscription({ ...subscription, optedIn })
      setSaving(true)
      setError(false)
      try {
        const response = await fetch('/api/newsletter/subscription', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ optedIn }),
        })
        if (!response.ok) throw new Error(String(response.status))
      } catch {
        setSubscription(previous)
        setError(true)
      } finally {
        setSaving(false)
      }
    },
    [subscription]
  )

  /** Whether the card has anything to show: newsletters can be sent, or the person is still subscribed. */
  const offered = !!subscription && (subscription.available || subscription.optedIn)

  return { subscription, loaded, saving, error, offered, setOptedIn, dismissError: () => setError(false) }
}
