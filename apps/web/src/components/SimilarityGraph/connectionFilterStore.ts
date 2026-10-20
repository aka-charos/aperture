/**
 * The viewer's hidden connection types, shared by every graph and legend.
 *
 * A module store rather than a context: the Explore sidebar, the graph footer
 * and a title's Similar graph sit in unrelated subtrees, and they must agree
 * the moment one of them is toggled. Remembered in localStorage as a per-viewer
 * convenience; storage that throws or comes back empty just means everything
 * is shown. Another tab's change arrives through the `storage` event, so a tab
 * opened earlier cannot write its stale set back over it.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ConnectionType, GraphData } from './types'
import { CONNECTION_TYPES, filterGraphByConnectionTypes, parseHiddenConnectionTypes } from './connectionFilter'

const STORAGE_KEY = 'aperture_graph_hidden_connection_types'

function load(): ReadonlySet<ConnectionType> {
  try {
    return new Set(parseHiddenConnectionTypes(localStorage.getItem(STORAGE_KEY)))
  } catch {
    return new Set()
  }
}

let hidden: ReadonlySet<ConnectionType> = load()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function set(next: ReadonlySet<ConnectionType>) {
  hidden = next
  try {
    if (next.size === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    // Kept for this page load only.
  }
  notify()
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return
  hidden = load()
  notify()
}

function subscribe(listener: () => void) {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
    }
  }
}

const getSnapshot = () => hidden

export function useHiddenConnectionTypes() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  /**
   * Hide or show one type. The last type still shown cannot be hidden: a graph
   * with every line switched off is bare centres with nothing saying why.
   */
  const toggle = useCallback((type: ConnectionType) => {
    const next = new Set(hidden)
    if (next.has(type)) next.delete(type)
    else if (next.size < CONNECTION_TYPES.length - 1) next.add(type)
    else return
    set(next)
  }, [])

  /** Show this type alone: the quickest way out of a crowded graph. */
  const showOnly = useCallback((type: ConnectionType) => {
    set(new Set(CONNECTION_TYPES.filter((other) => other !== type)))
  }, [])

  const showAll = useCallback(() => set(new Set()), [])

  return { hidden: current, toggle, showOnly, showAll }
}

/**
 * `data` as the viewer's filter draws it. Everything that describes a graph
 * (the canvas, the item count, a playlist made from it) reads this, so none of
 * them can disagree about which posters are on it.
 */
export function useFilteredGraph(data: GraphData | null): GraphData | null {
  const { hidden: current } = useHiddenConnectionTypes()
  return useMemo(() => (data ? filterGraphByConnectionTypes(data, current) : null), [data, current])
}
