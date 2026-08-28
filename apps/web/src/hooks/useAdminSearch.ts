import { useContext } from 'react'
import { AdminSearchContext, type AdminSearchContextValue } from './admin-search-context'

const CLOSED: AdminSearchContextValue = {
  open: () => {},
  close: () => {},
  isOpen: false,
}

/**
 * The settings palette's controls. Falls back to a no-op rather than throwing
 * when no provider is mounted, so a component that offers a "search settings"
 * affordance can render for a non-admin without a guard at every call site.
 */
export function useAdminSearch(): AdminSearchContextValue {
  return useContext(AdminSearchContext) ?? CLOSED
}
