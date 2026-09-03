import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { syncUiLanguageFromServer } from '@/i18n/syncUiLanguage'
import { clearUserScopedCaches } from '@/lib/clientCaches'
import { AuthContext, type ImpersonationState, type User } from './auth-context'

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
          setSessionError(null)
        } else {
          setUser(null)
          setImpersonation(null)
          // Check if there was a session error (e.g., SESSION_SECRET changed)
          if (data.sessionError && data.message) {
            setSessionError(data.message)
          }
        }
      } else {
        setUser(null)
        setImpersonation(null)
      }
    } catch {
      setUser(null)
      setImpersonation(null)
    } finally {
      setLoading(false)
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
      const error = await response.json()
      throw new Error(error.error || 'Login failed')
    }

    const data = await response.json()
    setUser(data.user)

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
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        sessionError,
        impersonation,
        login,
        logout,
        checkAuth,
        clearSessionError,
        impersonate,
        stopImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
