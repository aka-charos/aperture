import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pairKey, trailLookupNeeded } from './trail'
import type { TrailLink, TrailResponse, TrailTitle } from './types'

export class NextRequestError extends Error {
  constructor(readonly status: number) {
    super(`Next from here request failed (${status})`)
  }
}

/** GET `/api/next-from-here/<path>`; throws NextRequestError on a non-2xx answer. */
export async function fetchNext<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/next-from-here/${path}`, { credentials: 'include', signal })
  if (!response.ok) throw new NextRequestError(response.status)
  return (await response.json()) as T
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export interface TrailLimits {
  /** The most titles a trail holds; older ones fall off the front. */
  maxTrailLength: number
  /** How many steps "Take me somewhere" walks. */
  walkSteps: number
}

/** The limits the API enforces, decided there (null until they arrive). */
export function useTrailLimits(): TrailLimits | null {
  const [limits, setLimits] = useState<TrailLimits | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchNext<TrailLimits>('limits', controller.signal)
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
  // Refs a lookup asked about and the API did not return: out of scope or
  // deleted. See trailLookupNeeded for why they must be remembered.
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  // Read through refs so knowledge arriving from elsewhere does not restart
  // (and abort) a lookup already on its way.
  const known = useRef({ cards, links, gone })
  known.current = { cards, links, gone }

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
    const refs = key.split(',').slice(-maxTrail)
    const { cards: knownCards, links: knownLinks, gone: knownGone } = known.current
    const missing = trailLookupNeeded(
      refs,
      (ref) => knownCards.has(ref),
      (pair) => knownLinks.has(pair),
      knownGone
    )
    if (!missing || asked.current.has(key)) return
    asked.current.add(key)
    const controller = new AbortController()
    fetchNext<TrailResponse>(`trail?refs=${encodeURIComponent(refs.join(','))}`, controller.signal)
      .then((response) => {
        const returned = new Set(response.titles.map((title) => title.ref))
        const missingRefs = refs.filter((ref) => !returned.has(ref))
        if (missingRefs.length > 0) {
          setGone((current) => {
            if (missingRefs.every((ref) => current.has(ref))) return current
            return new Set([...current, ...missingRefs])
          })
        }
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
