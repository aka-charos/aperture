import { useCallback, useEffect, useState } from 'react'
import { fetchNext } from '../../next/api'
import type { NextItem, NextSummaryResponse } from '../../next/types'

export type NextSummaryStatus = 'loading' | 'ready' | 'failed'

export interface NextSummaryState {
  status: NextSummaryStatus
  /** The best suggestions after this title, as many as the admin set; only when `status` is `ready`. */
  items: NextItem[] | null
  /** Ask again after a failure. */
  retry: () => void
}

type Entry = { ref: string; status: 'loading' | 'failed' } | { ref: string; status: 'ready'; items: NextItem[] }

/**
 * The suggestions after one title, from Next from here, asked as the page
 * opens: they are the right column of every title page. Keyed by title, so an
 * answer for the title shown before is never shown for this one (the detail
 * dialog swaps titles in place).
 *
 * Asked again whenever `revision` moves (`useWatchedRevision`, as the Next
 * from here page does), since a title just finished must leave the list. The
 * answer already shown stays up meanwhile, and a failed refresh keeps it.
 */
export function useNextSummary(titleRef: string | null, revision = 0): NextSummaryState {
  const [entry, setEntry] = useState<Entry | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!titleRef) return
    const controller = new AbortController()
    const keepShown = (entry: Entry | null): entry is Entry => entry?.ref === titleRef && entry.status === 'ready'
    setEntry((current) => (keepShown(current) ? current : { ref: titleRef, status: 'loading' }))
    fetchNext<NextSummaryResponse>(`summary?title=${encodeURIComponent(titleRef)}`, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setEntry({ ref: titleRef, status: 'ready', items: response.items })
      })
      .catch(() => {
        // An abort is this title being left, not a failure to report.
        if (!controller.signal.aborted) {
          setEntry((current) => (keepShown(current) ? current : { ref: titleRef, status: 'failed' }))
        }
      })
    return () => controller.abort()
  }, [titleRef, attempt, revision])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const current = entry != null && entry.ref === titleRef ? entry : null

  return {
    status: current?.status ?? 'loading',
    items: current?.status === 'ready' ? current.items : null,
    retry,
  }
}
