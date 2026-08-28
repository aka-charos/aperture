import { createContext } from 'react'

export interface AdminSearchContextValue {
  open: () => void
  close: () => void
  isOpen: boolean
}

/**
 * Null when no provider is mounted, which is every non-admin session — the
 * palette and its shortcut are admin-only, and a hook that throws would make
 * that a crash rather than an absence.
 */
export const AdminSearchContext = createContext<AdminSearchContextValue | null>(null)
