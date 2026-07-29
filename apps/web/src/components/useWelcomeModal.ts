import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

/**
 * The guide explains how AI recommendations are built, which is one page out of
 * the whole app — so it only lets itself in there. Everywhere else it opens on
 * request from the user menu.
 */
const WELCOME_ROUTE = '/recommendations'

/**
 * How long the guide stays away once it has been closed. A plain close applies
 * `session`: the guide is an explanation, and re-explaining on every refresh is
 * what made it feel like nagging.
 */
export type WelcomeDismissal = 'session' | 'day' | 'week' | 'never'

/** Pre-snooze key, still the "never" flag — anyone who already ticked the box stays dismissed. */
const DISMISSED_KEY = 'aperture-welcome-dismissed'
/** Epoch ms. The guide stays away until the clock passes it. */
const SNOOZE_UNTIL_KEY = 'aperture-welcome-snooze-until'
/**
 * Session storage, holding the user id it was set for. This is "until I sign in
 * again" as closely as the browser can express it: it dies with the tab, and
 * another user signing in here doesn't inherit it. Signing out and back in as
 * the same user in the same tab keeps it, which is the reading nobody minds.
 */
const SESSION_SNOOZE_KEY = 'aperture-welcome-session-snooze'

const DAY_MS = 24 * 60 * 60 * 1000
const SNOOZE_DURATIONS: Record<'day' | 'week', number> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
}

// Storage can be unavailable (private modes, blocked cookies) and throws on the
// property access itself, not just the call. A welcome guide is never worth a
// crash, so every access is guarded and failure just means "no preference".
function readStored(session: boolean, key: string): string | null {
  try {
    return (session ? window.sessionStorage : window.localStorage).getItem(key)
  } catch {
    return null
  }
}

function writeStored(session: boolean, key: string, value: string): void {
  try {
    ;(session ? window.sessionStorage : window.localStorage).setItem(key, value)
  } catch {
    // ignore
  }
}

function clearStored(session: boolean, key: string): void {
  try {
    ;(session ? window.sessionStorage : window.localStorage).removeItem(key)
  } catch {
    // ignore
  }
}

function isSnoozed(userKey: string): boolean {
  if (readStored(false, DISMISSED_KEY) === 'true') return true
  if (readStored(true, SESSION_SNOOZE_KEY) === userKey) return true
  const until = Number(readStored(false, SNOOZE_UNTIL_KEY))
  return Number.isFinite(until) && until > Date.now()
}

export function useWelcomeModal() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { user } = useAuth()
  const userKey = user?.id ?? 'anonymous'

  // Landing on the recommendations page is the only thing that opens the guide
  // by itself. Navigating away and back re-checks, so a snooze taken here holds
  // for the rest of its term.
  useEffect(() => {
    if (pathname !== WELCOME_ROUTE) return
    if (isSnoozed(userKey)) return
    setOpen(true)
  }, [pathname, userKey])

  const showWelcome = useCallback(() => setOpen(true), [])

  const hideWelcome = useCallback(
    (choice: WelcomeDismissal = 'session') => {
      setOpen(false)
      if (choice === 'never') {
        writeStored(false, DISMISSED_KEY, 'true')
        return
      }
      if (choice === 'session') {
        writeStored(true, SESSION_SNOOZE_KEY, userKey)
        return
      }
      writeStored(false, SNOOZE_UNTIL_KEY, String(Date.now() + SNOOZE_DURATIONS[choice]))
    },
    [userKey]
  )

  const resetWelcome = useCallback(() => {
    clearStored(false, DISMISSED_KEY)
    clearStored(false, SNOOZE_UNTIL_KEY)
    clearStored(true, SESSION_SNOOZE_KEY)
    setOpen(true)
  }, [])

  return { open, showWelcome, hideWelcome, resetWelcome }
}
