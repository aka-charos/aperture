import { useEffect, useState } from 'react'
import { useCapability } from './useCapability'
import {
  CONTENT_SEARCH_DEBOUNCE_MS,
  CONTENT_SEARCH_MIN_QUERY,
  hasMissing,
  type MissingForQuery,
  type MissingSummary,
} from '../lib/missingTitles'

/**
 * How many titles matching `query` the library is missing, read from the
 * `missing` summary of `GET /api/seerr/search` (the request panel's search).
 *
 * Its own request, separate from the library search, so library results never
 * wait for it. The previous answer stays up while the next query is asked,
 * carrying the query it was counted for, so the banner neither blinks nor
 * shifts the results on every keystroke, and its link always matches its text.
 *
 * Null when there is nothing to say: no capability to request, a query too
 * short, or an answer with nothing missing. A failed search (503 for no request
 * backend, anything else) also clears it: the banner is an offer, never a status
 * report, so a failure says nothing rather than claim the library has everything.
 */
export function useMissingTitles(query: string): MissingForQuery | null {
  const canRequest = useCapability('discover:request')
  const [found, setFound] = useState<MissingForQuery | null>(null)

  useEffect(() => {
    const term = query.trim()
    if (!canRequest || term.length < CONTENT_SEARCH_MIN_QUERY) {
      setFound(null)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const url = new URL('/api/seerr/search', window.location.origin)
        url.searchParams.set('query', term)
        const res = await fetch(url.toString(), { credentials: 'include', signal: controller.signal })
        const data = res.ok
          ? ((await res.json()) as { canRequest?: boolean; missing?: MissingSummary })
          : null
        if (controller.signal.aborted) return
        setFound(data?.canRequest === true && hasMissing(data.missing) ? { ...data.missing, query: term } : null)
      } catch {
        if (!controller.signal.aborted) setFound(null)
      }
    }, CONTENT_SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, canRequest])

  return found
}
