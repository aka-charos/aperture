import { createContext } from 'react'

export interface User {
  id: string
  username: string
  displayName: string | null
  provider: 'emby' | 'jellyfin'
  providerUserId: string
  isAdmin: boolean
  isEnabled: boolean
  canManageWatchHistory: boolean
  collectionsEnabled: boolean
  avatarUrl: string | null
}

/**
 * Set while an admin is viewing the app as someone else.
 *
 * `user` above is the account being viewed — every page reads it and needs no
 * knowledge of this — and this is the admin who is really there. Its presence
 * is what puts the exit control on screen, so anything that renders the app
 * must be able to reach it.
 */
export interface ImpersonationState {
  /** The real operator, the one the exit returns to. */
  admin: User
  /** When the assumption lapses by itself, ISO-8601. */
  expiresAt: string
}

export interface AuthContextType {
  user: User | null
  loading: boolean
  sessionError: string | null
  impersonation: ImpersonationState | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  clearSessionError: () => void
  /** Admin only. Starts a read-only assumed session and reloads into it. */
  impersonate: (userId: string) => Promise<void>
  /** Ends an assumed session and reloads back into the admin's own. */
  stopImpersonation: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)
