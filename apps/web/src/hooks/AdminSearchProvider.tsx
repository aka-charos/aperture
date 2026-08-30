import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AdminSearchContext } from './admin-search-context'
import { AdminSearchPalette } from '@/components/AdminSearchPalette'
import { matchSearchShortcut } from '@/lib/searchShortcut'

/**
 * Holds the settings palette and its shortcut.
 *
 * Mounted only for admins, in `Layout`, so the palette works from any page
 * rather than only from inside the console — which is the point: the fastest
 * path to a setting should not start with navigating to the settings.
 *
 * ⌘⇧K / Ctrl+Shift+K. ⌘K stays with `GlobalSearch`; see the note there on why
 * these are two palettes and not one, and `matchSearchShortcut` for why
 * neither listener is allowed to decide which of them a keystroke belongs to.
 */
export function AdminSearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchSearchShortcut(e) === 'admin') {
        e.preventDefault()
        setIsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen])

  return (
    <AdminSearchContext.Provider value={value}>
      {children}
      <AdminSearchPalette open={isOpen} onClose={close} />
    </AdminSearchContext.Provider>
  )
}
