import { createContext } from 'react'

/** What a page announces about itself: the words that used to sit above it. */
export interface PageHeader {
  title: string
  description?: string
}

export interface PageHeaderContextValue {
  header: PageHeader | null
  setHeader: (header: PageHeader | null) => void
}

/**
 * Carries the current page's title up to the app bar.
 *
 * Provided by Layout, so it spans exactly one page at a time — the bar and the
 * `<Outlet />` under it are siblings inside the same provider.
 */
export const PageHeaderContext = createContext<PageHeaderContextValue | null>(null)
