import { useEffect, useState } from 'react'
import { createRequestGuard, type RequestGuard } from '../lib/requestGuard'

/**
 * A request guard whose generation ends whenever `session` changes, and on unmount.
 *
 * Pass what identifies "this opening of this dialog" — e.g. the playlist being edited while the
 * dialog is open, and null while it is closed — so closing or switching drops every answer still
 * in flight. See ../lib/requestGuard.ts.
 */
export function useRequestGuard(session: unknown): RequestGuard {
  const [guard] = useState(createRequestGuard)

  useEffect(() => {
    return () => guard.invalidate()
  }, [guard, session])

  return guard
}
