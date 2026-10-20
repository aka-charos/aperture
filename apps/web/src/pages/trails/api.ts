import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pairKey } from './labels'
import type { TrailLink, TrailResponse, TrailTitle } from './types'

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

export interface TrailLimits {
  /** The most titles a trail holds; older ones fall off the front. */
  maxTrailLength: number
  /** How many steps "Take me on a trail" walks. */
  walkSteps: number
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
 * The trail's title cards and the link between each consecutive pair, by ref
 * and by `pairKey`. Steps taken on the page supply both as they happen (the
 * thread followed is the link), and a walk supplies its own; only a trail the
 * page holds without them — a URL opened cold, a title picked to start from —
 * is looked up, once, through `/trail`, which names the strongest thing each
 * pair shares. A link the page already knows is kept over the looked-up one,
 * so a step shows the thread actually followed. Nothing is asked before the
 * limits arrive, since the lookup is capped by them.
 */
export function useTrailData(trail: readonly string[], maxTrail: number | null) {
  const [cards, setCards] = useState<ReadonlyMap<string, TrailTitle>>(() => new Map())
  const [links, setLinks] = useState<ReadonlyMap<string, TrailLink | null>>(() => new Map())
  const asked = useRef(new Set<string>())
  // Read through refs so knowledge arriving from elsewhere does not restart
  // (and abort) a lookup already on its way.
  const known = useRef({ cards, links })
  known.current = { cards, links }

  const remember = useCallback((titles: readonly TrailTitle[]) => {
    if (titles.length === 0) return
    setCards((current) => {
      if (titles.every((title) => current.get(title.ref) === title)) return current
      const next = new Map(current)
      for (const title of titles) next.set(title.ref, title)
      return next
    })
  }, [])

  const rememberLink = useCallback((from: string, to: string, link: TrailLink | null, replace = true) => {
    setLinks((current) => {
      const key = pairKey(from, to)
      if (current.has(key) && (!replace || current.get(key) === link)) return current
      return new Map(current).set(key, link)
    })
  }, [])

  const key = trail.join(',')
  useEffect(() => {
    if (!key || maxTrail == null) return
    const refs = key.split(',')
    const { cards: knownCards, links: knownLinks } = known.current
    const missing =
      refs.some((ref) => !knownCards.has(ref)) ||
      refs.slice(1).some((ref, i) => !knownLinks.has(pairKey(refs[i], ref)))
    if (!missing || asked.current.has(key)) return
    asked.current.add(key)
    const controller = new AbortController()
    fetchTrails<TrailResponse>(`trail?refs=${encodeURIComponent(refs.slice(-maxTrail).join(','))}`, controller.signal)
      .then((response) => {
        remember(response.titles)
        response.links.forEach((link, i) => {
          rememberLink(response.titles[i].ref, response.titles[i + 1].ref, link, false)
        })
      })
      .catch(() => {
        // Not an answer about the trail: it may be asked again.
        asked.current.delete(key)
      })
    return () => controller.abort()
  }, [key, maxTrail, remember, rememberLink])

  return useMemo(() => ({ cards, links, remember, rememberLink }), [cards, links, remember, rememberLink])
}

/** How many answers the page keeps, so walking back along a trail asks nothing. */
const RECENT_ANSWERS = 24

/**
 * Recent answers by key, and the one failure. A failure is kept only
 * until the next request starts, so returning to a title that failed asks again.
 */
export function useAnswers<T>() {
  const [answers, setAnswers] = useState<ReadonlyMap<string, T>>(() => new Map())
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  // Fetch effects ask through this rather than depending on `answers`: as a
  // dependency, every stored answer (a surprise pair, say) would restart the
  // effect and abort the request still on its way for the current key.
  const answersRef = useRef(answers)
  answersRef.current = answers
  const hasAnswer = useCallback((key: string) => answersRef.current.has(key), [])

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

  return { answers, hasAnswer, store, failure, fail, clearFailure }
}
