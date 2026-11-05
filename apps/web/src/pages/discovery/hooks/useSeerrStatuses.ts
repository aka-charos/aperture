import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import type { SeerrMediaStatus } from '../types'
import {
  forgetUnanswered,
  pendingStatusBatches,
  STATUS_RETRY_MS,
  typedStatuses,
  type StatusBatch,
  type StatusItem,
} from './statusBatches'

interface Session {
  controller: AbortController
  asked: Set<string>
  attempts: Map<string, number>
  retryTimer?: ReturnType<typeof setTimeout>
}

/**
 * Availability and request badges for what is on screen, keyed by `mediaKey`.
 *
 * Seerr answers one title at a time, so this is never part of loading a list: cards
 * appear first and the badges fill in. Each title is asked about once per person
 * while the page is open; one left unanswered is asked again shortly, a few times,
 * so a slow Seerr does not cost the badges for the whole visit. Leaving the page, or
 * a change of account, aborts what is outstanding.
 */
export function useSeerrStatuses(items: readonly StatusItem[]): Record<string, SeerrMediaStatus> {
  const { user } = useAuth()
  const userId = user?.id
  const [values, setValues] = useState<Record<string, SeerrMediaStatus>>({})
  const [retry, setRetry] = useState(0)
  const session = useRef<Session | null>(null)

  useEffect(() => {
    const current: Session = {
      controller: new AbortController(),
      asked: new Set(),
      attempts: new Map(),
    }
    session.current = current
    setValues({})
    return () => {
      current.controller.abort()
      clearTimeout(current.retryTimer)
    }
  }, [userId])

  const wanted = JSON.stringify(items.map((item) => [item.tmdbId, item.mediaType]))

  useEffect(() => {
    const current = session.current
    if (!userId || !current) return
    const list = (JSON.parse(wanted) as [number, StatusItem['mediaType']][]).map(
      ([tmdbId, mediaType]) => ({ tmdbId, mediaType })
    )
    const { controller, asked, attempts } = current

    const settle = (batch: StatusBatch, answers: Record<string, SeerrMediaStatus>) => {
      if (!forgetUnanswered(batch, answers, asked, attempts) || current.retryTimer) return
      current.retryTimer = setTimeout(() => {
        current.retryTimer = undefined
        setRetry((n) => n + 1)
      }, STATUS_RETRY_MS)
    }

    void (async () => {
      for (const batch of pendingStatusBatches(list, asked)) {
        if (controller.signal.aborted) return
        try {
          const response = await fetch('/api/seerr/status/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            signal: controller.signal,
            body: JSON.stringify({ items: batch.items }),
          })
          if (!response.ok) throw new Error(`status ${response.status}`)
          const data = (await response.json()) as { statuses?: Record<string, SeerrMediaStatus> }
          if (controller.signal.aborted) return
          const answers = typedStatuses(batch, data.statuses)
          setValues((prev) => ({ ...prev, ...answers }))
          settle(batch, answers)
        } catch {
          // Badges are optional. The cards stay as they are.
          if (!controller.signal.aborted) settle(batch, {})
        }
      }
    })()
  }, [wanted, userId, retry])

  return values
}
