/**
 * The highlighted connection types, shared by every graph and legend on screen.
 *
 * A module store rather than a context: the Explore sidebar, the graph footer
 * and a title's Similar graph sit in unrelated subtrees, and they must agree
 * the moment one of them is clicked. Deliberately NOT remembered across loads:
 * a highlight is a way of reading the graph in front of you, and one left over
 * from another page would dim a graph for reasons nobody can see.
 *
 * `preview` is the legend entry under the pointer; while it is set it stands in
 * for the chosen set, so hovering a type shows what clicking it would do.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ConnectionType } from './types'

interface HighlightState {
  highlighted: ReadonlySet<ConnectionType>
  preview: ConnectionType | null
}

let state: HighlightState = { highlighted: new Set(), preview: null }
const listeners = new Set<() => void>()

function set(next: Partial<HighlightState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => state

export function useConnectionHighlight() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  /** Add or remove one type from the highlight. */
  const toggle = useCallback((type: ConnectionType) => {
    const next = new Set(state.highlighted)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    set({ highlighted: next })
  }, [])

  const clear = useCallback(() => set({ highlighted: new Set() }), [])

  const setPreview = useCallback((type: ConnectionType | null) => {
    if (state.preview !== type) set({ preview: type })
  }, [])

  // What a graph draws: the hovered entry while there is one, else the choice.
  // Memoised on the two values so a graph's effect does not run every render.
  const { highlighted, preview } = current
  const effective = useMemo<ReadonlySet<ConnectionType>>(
    () => (preview ? new Set([preview]) : highlighted),
    [highlighted, preview]
  )

  return { highlighted, preview, effective, toggle, clear, setPreview }
}
