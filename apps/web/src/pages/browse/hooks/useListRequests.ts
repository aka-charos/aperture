import { useLayoutEffect, useRef, useState } from 'react'
import { createRequestGuard, type RequestGuard } from '../../../lib/requestGuard'

/**
 * The request guard for one Browse list (see listRequests.ts): its generation
 * ends whenever `key` changes, and on unmount.
 *
 * A layout effect, not a passive one like `useRequestGuard`'s: its cleanup runs
 * inside the commit that puts the new key on screen, so no reply can resolve in
 * between and still read as current. With a passive effect a reply landing
 * after the commit, before the effects flushed, was applied under the new
 * filters (and only the fetch effect's reset, right after, cleared it again).
 *
 * `key` must change whenever the list's fetch effect would start a new list,
 * or a request it abandons keeps writing. `onEnd` runs as a generation ends:
 * the cancelled requests no longer settle, so whatever "load more" they left
 * pending is cleared there.
 */
export function useListRequests(key: string | null, onEnd: () => void): RequestGuard {
  const [guard] = useState(createRequestGuard)
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  useLayoutEffect(() => {
    return () => {
      guard.invalidate()
      onEndRef.current()
    }
  }, [guard, key])

  return guard
}
