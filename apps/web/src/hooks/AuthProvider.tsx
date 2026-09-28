import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { syncUiLanguageFromServer } from '@/i18n/syncUiLanguage'
import { clearUserScopedCaches } from '@/lib/clientCaches'
import {
  AuthContext,
  type Capabilities,
  type ImpersonationState,
  type User,
} from './auth-context'

/**
 * Crossing into or out of an assumed session is a full page load, not a state
 * update.
 *
 * The identity is baked into a tree of providers and a set of localStorage
 * caches, several of which read once on mount. Trying to swap it in place means
 * finding every one of those and inventing a reset for it — and being wrong
 * about a single one shows the admin their own data while claiming to be
 * someone else. A reload is the one move that cannot leave a survivor.
 */
function reloadInto(path: string): void {
  clearUserScopedCaches()
  window.location.assign(path)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(null)
  // Decided server-side and replaced wholesale on every auth check, so a
  // permission revoked between two loads is gone from the nav on the next one.
  const [capabilities, setCapabilities] = useState<Capabilities>({})
  // Who the capabilities currently on screen belong to, for refreshCapabilities.
  const userIdRef = useRef<string | null>(null)
  useEffect(() => {
    userIdRef.current = user?.id ?? null
  }, [user])

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/check', {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        if (data.authenticated) {
          setUser(data.user)
          setImpersonation(data.impersonation ?? null)
          setCapabilities(data.capabilities ?? {})
          setSessionError(null)
        } else {
          setUser(null)
          setImpersonation(null)
          setCapabilities({})
          // Check if there was a session error (e.g., SESSION_SECRET changed)
          if (data.sessionError && data.message) {
            setSessionError(data.message)
          }
        }
      } else {
        setUser(null)
        setImpersonation(null)
        setCapabilities({})
      }
    } catch {
      setUser(null)
      setImpersonation(null)
      setCapabilities({})
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Re-read the decided capabilities without touching the session.
   *
   * For answers that can change under a signed-in person — an admin connecting
   * them to someone makes `social` true — so a feature can appear without a
   * reload. Deliberately NOT `checkAuth`: that one treats any failure as signed
   * out, which is right at boot and wrong for a background refresh, where a
   * blip would log someone out mid-page. Here only a successful answer about
   * the SAME account replaces anything; everything else leaves state alone and
   * lets the next real request deal with a dead session.
   */
  const refreshCapabilities = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/check', { credentials: 'include' })
      if (!response.ok) return
      const data = await response.json()
      if (!data.authenticated || data.user?.id == null || data.user.id !== userIdRef.current) return
      setCapabilities(data.capabilities ?? {})
    } catch {
      // Leave what is on screen; see above.
    }
  }, [])

  const clearSessionError = useCallback(() => {
    setSessionError(null)
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const login = async (username: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      // The code and server name ride along so the login page can word a
      // refusal in the reader's language; the English text is the fallback.
      throw Object.assign(new Error(error.error || 'Login failed'), {
        code: typeof error.code === 'string' ? error.code : undefined,
        serverName: typeof error.serverName === 'string' ? error.serverName : undefined,
      })
    }

    const data = await response.json()
    setUser(data.user)
    setCapabilities(data.capabilities ?? {})

    try {
      await syncUiLanguageFromServer()
    } catch {
      // ignore locale sync failures
    }
  }

  /**
   * Start viewing the app as another user. Admin only; the server checks that
   * too, and re-checks it on every subsequent request.
   */
  const impersonate = async (userId: string) => {
    const response = await fetch('/api/auth/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.error || 'Could not view the app as this user')
    }

    reloadInto('/')
  }

  /**
   * Return to the admin's own session.
   *
   * Deliberately reloads even when the request fails: the assumption lives in a
   * cookie the admin's own session cookie sits beside, so the worst case for a
   * failed call is that the next page load resolves the cookie again and the
   * banner is still there — never a half-exited state. Being unable to leave is
   * the one outcome this feature must not have.
   */
  const stopImpersonation = async () => {
    try {
      await fetch('/api/auth/impersonate/stop', {
        method: 'POST',
        credentials: 'include',
      })
    } finally {
      reloadInto('/admin/access/users')
    }
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } finally {
      setUser(null)
      setImpersonation(null)
      setCapabilities({})
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        capabilities,
        loading,
        sessionError,
        impersonation,
        login,
        logout,
        checkAuth,
        refreshCapabilities,
        clearSessionError,
        impersonate,
        stopImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
