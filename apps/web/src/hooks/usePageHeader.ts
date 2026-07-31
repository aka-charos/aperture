import { useContext, useEffect } from 'react'
import { PageHeaderContext, type PageHeader } from './page-header-context'

/**
 * Publish this page's title and description to the app bar.
 *
 * Cleared on unmount, so a page that forgets to publish shows an empty bar
 * rather than the previous page's words. On a route change React runs the old
 * page's cleanup before the new page's effects, so the incoming title wins.
 *
 * Prefer `<PageHeading>` — it calls this *and* renders the fallback heading for
 * surfaces too narrow for the bar. This hook is for pages that need to publish
 * a title without any in-page block at all.
 */
export function usePageHeader(title: string, description?: string) {
  const setHeader = useContext(PageHeaderContext)?.setHeader

  useEffect(() => {
    if (!setHeader) return
    setHeader({ title, description })
    return () => setHeader(null)
  }, [setHeader, title, description])
}

/** The current page's header, for whoever is drawing it. */
export function usePageHeaderValue(): PageHeader | null {
  return useContext(PageHeaderContext)?.header ?? null
}
