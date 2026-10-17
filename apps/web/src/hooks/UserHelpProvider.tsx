import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { docsForLocation, tourForLocation } from '@/pages/guide/routeDocs'
import { UserHelpContext, type OpenHelpOptions, type UserHelpContextValue } from './user-help-context'

/**
 * Lazy, and mounted only once asked for: it carries the whole user guide,
 * which someone who never opens help never downloads.
 */
const UserHelpDrawer = lazy(async () => ({
  default: (await import('@/pages/guide/UserHelpDrawer')).UserHelpDrawer,
}))

interface Request {
  docs: readonly string[]
  anchor?: string
  /** A tour for the screen the drawer was opened on, offered in its header. */
  tour?: string
  /** Remounts the drawer, so each opening starts on its own first page. */
  key: number
}

/**
 * The one user guide drawer, for everything that opens it. It closes on a
 * screen change, because the pages it shows were chosen for the screen it was
 * opened on.
 */
export function UserHelpProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<Request | null>(null)
  const counter = useRef(0)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.search])

  const openHelp = useCallback(
    (docs?: readonly string[], options: OpenHelpOptions = {}) => {
      const pages = docs && docs.length > 0 ? docs : docsForLocation(location.pathname, location.search)
      if (pages.length === 0) return
      counter.current += 1
      setRequest({
        docs: pages,
        anchor: options.anchor,
        tour: options.offerScreenTour ? (tourForLocation(location.pathname, location.search) ?? undefined) : undefined,
        key: counter.current,
      })
      setOpen(true)
    },
    [location.pathname, location.search]
  )

  const value = useMemo<UserHelpContextValue>(() => ({ openHelp, isOpen: open }), [openHelp, open])

  return (
    <UserHelpContext.Provider value={value}>
      {children}
      {request && (
        <Suspense fallback={null}>
          <UserHelpDrawer
            key={request.key}
            open={open}
            docs={request.docs}
            anchor={request.anchor}
            tour={request.tour}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </UserHelpContext.Provider>
  )
}
