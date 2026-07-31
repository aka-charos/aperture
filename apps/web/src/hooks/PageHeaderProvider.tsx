import { useMemo, useState, type ReactNode } from 'react'
import { PageHeaderContext, type PageHeader } from './page-header-context'

/**
 * Holds whatever the current page has announced about itself.
 *
 * Mounted by Layout above both the app bar and the router outlet. State changes
 * here re-render the page too, which is free: the header only moves when the
 * route does.
 */
export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<PageHeader | null>(null)
  const value = useMemo(() => ({ header, setHeader }), [header])
  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>
}
