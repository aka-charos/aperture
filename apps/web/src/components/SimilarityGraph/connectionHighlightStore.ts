/**
 * The highlighted connection types, shared by every graph and legend on screen.
 *
 * A module store rather than a context: the Explore sidebar, the graph footer
 * and a title's Similar graph sit in unrelated subtrees, and they must agree
 * the moment one of them is clicked.
 *
 * It lives exactly as long as some legend is mounted. A legend is the only
 * thing that shows a highlight is on, so a highlight with no legend on screen
 * would dim a graph for reasons nobody can see: when the last legend goes (the
 * page is left, the graph view closed), the store resets, and it is never
 * written to storage. `preview` is the legend entry under the pointer and is
 * cleared whenever any legend unmounts, since that legend can no longer
 * receive the pointerleave that would clear it.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ConnectionType } from './types'
import { effectiveHighlight, toggleHighlight } from './connectionHighlight'

interface HighlightState {
  highlighted: ReadonlySet<ConnectionType>
  preview: ConnectionType | null
}

const EMPTY: HighlightState = { highlighted: new Set(), preview: null }

let state: HighlightState = EMPTY
let mountedLegends = 0
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

/** The current state, for tests and nothing else. */
export function readHighlightState(): HighlightState {
  return state
}

/**
 * Called by every legend while it is mounted. Returns the cleanup: the preview
 * goes with any legend, everything goes with the last one.
 */
export function registerLegend(): () => void {
  mountedLegends += 1
  return () => {
    mountedLegends -= 1
    if (mountedLegends <= 0) {
      mountedLegends = 0
      if (state !== EMPTY) set(EMPTY)
    } else if (state.preview !== null) {
      set({ preview: null })
    }
  }
}

export function toggleHighlightedType(type: ConnectionType) {
  set({ highlighted: toggleHighlight(state.highlighted, type) })
}

export function clearHighlight() {
  set({ highlighted: new Set() })
}

export function setHighlightPreview(type: ConnectionType | null) {
  if (state.preview !== type) set({ preview: type })
}

/** For a legend: the state and the controls, and its registration. */
export function useLegendHighlight() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => registerLegend(), [])
  const toggle = useCallback((type: ConnectionType) => toggleHighlightedType(type), [])
  const setPreview = useCallback((type: ConnectionType | null) => setHighlightPreview(type), [])
  return { highlighted: current.highlighted, toggle, clear: clearHighlight, setPreview }
}

/** For a graph: what to draw. Stable while neither the choice nor the preview changes. */
export function useEffectiveHighlight(): ReadonlySet<ConnectionType> {
  const { highlighted, preview } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => effectiveHighlight(highlighted, preview), [highlighted, preview])
}
