import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TrailTitle } from './types'

export class TrailsRequestError extends Error {
  constructor(readonly status: number) {
    super(`Trails request failed (${status})`)
  }
}

export async function fetchTrails<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/trails/${path}`, { credentials: 'include', signal })
  if (!response.ok) throw new TrailsRequestError(response.status)
  return (await response.json()) as T
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

const LOOKUP_BATCH = 20

export interface TrailLimits {
  maxCommonTitles: number
  maxSteps: number
}

/** The limits the API enforces, decided there (null until they arrive). */
export function useTrailLimits(): TrailLimits | null {
  const [limits, setLimits] = useState<TrailLimits | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchTrails<TrailLimits>('limits', controller.signal)
      .then(setLimits)
      .catch(() => {
        /* the page works without them: the API still enforces its own */
      })
    return () => controller.abort()
  }, [])
  return limits
}

/**
 * Title cards the page has seen, by ref. Every response feeds it (`remember`),
 * and refs the page holds without a card — a URL opened cold — are looked up
 * once. A ref the API does not return (out of scope, deleted) stays unknown and
 * is not asked about again.
 */
export function useTitleCache(refs: readonly string[]) {
  const [cards, setCards] = useState<ReadonlyMap<string, TrailTitle>>(() => new Map())
  const asked = useRef(new Set<string>())
  // Read through a ref so a card arriving from elsewhere does not restart (and
  // abort) a lookup already on its way.
  const cardsRef = useRef(cards)
  cardsRef.current = cards

  const remember = useCallback((titles: readonly TrailTitle[]) => {
    if (titles.length === 0) return
    setCards((current) => {
      if (titles.every((title) => current.get(title.ref) === title)) return current
      const next = new Map(current)
      for (const title of titles) next.set(title.ref, title)
      return next
    })
  }, [])

  const key = refs.join(',')
  useEffect(() => {
    const missing = key
      .split(',')
      .filter((ref) => ref && !cardsRef.current.has(ref) && !asked.current.has(ref))
    if (missing.length === 0) return
    for (const ref of missing) asked.current.add(ref)
    const controller = new AbortController()
    let answered = false
    // An aborted or failed lookup is not an answer about the title, so its refs
    // may be asked again. Released in the cleanup itself, not in the catch: the
    // next run of this effect starts before an aborted request settles, and
    // would otherwise find them still marked as asked and skip them for good.
    const release = () => {
      if (!answered) for (const ref of missing) asked.current.delete(ref)
    }
    // In batches comfortably under the API's limit, so a page holding more refs
    // than one lookup allows still resolves them all.
    const batches: string[][] = []
    for (let at = 0; at < missing.length; at += LOOKUP_BATCH) batches.push(missing.slice(at, at + LOOKUP_BATCH))
    Promise.all(
      batches.map((batch) =>
        fetchTrails<{ titles: TrailTitle[] }>(`titles?refs=${encodeURIComponent(batch.join(','))}`, controller.signal)
      )
    )
      .then((responses) => {
        answered = true
        remember(responses.flatMap((response) => response.titles))
      })
      .catch(release)
    return () => {
      release()
      controller.abort()
    }
  }, [key, remember])

  return useMemo(() => ({ cards, remember }), [cards, remember])
}

/** How many answers each mode keeps, so walking back along a trail asks nothing. */
const RECENT_ANSWERS = 24

/**
 * A mode's recent answers by key, and its one failure. A failure is kept only
 * until the next request starts, so returning to a title that failed asks again.
 */
export function useAnswers<T>() {
  const [answers, setAnswers] = useState<ReadonlyMap<string, T>>(() => new Map())
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)

  const store = useCallback((key: string, value: T) => {
    setAnswers((previous) => {
      const next = new Map(previous)
      next.delete(key)
      next.set(key, value)
      for (const oldest of next.keys()) {
        if (next.size <= RECENT_ANSWERS) break
        next.delete(oldest)
      }
      return next
    })
  }, [])

  const fail = useCallback((key: string, message: string) => setFailure({ key, message }), [])
  const clearFailure = useCallback(() => setFailure(null), [])

  return { answers, store, failure, fail, clearFailure }
}
