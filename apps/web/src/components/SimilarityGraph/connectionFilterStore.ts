/**
 * The viewer's hidden connection types, shared by every graph and legend.
 *
 * A module store rather than a context: the Explore sidebar, the graph footer
 * and a title's Similar graph sit in unrelated subtrees, and they must agree
 * the moment one of them is toggled. Remembered in localStorage as a per-viewer
 * convenience; storage that throws or comes back empty just means everything
 * is shown.
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { ConnectionType } from './types'
import { CONNECTION_TYPES, parseHiddenConnectionTypes } from './connectionFilter'

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

function set(next: ReadonlySet<ConnectionType>) {
  hidden = next
  try {
    if (next.size === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    // Kept for this page load only.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => hidden

export function useHiddenConnectionTypes() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const toggle = useCallback((type: ConnectionType) => {
    const next = new Set(hidden)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    set(next)
  }, [])

  /** Show this type alone: the quickest way out of a crowded graph. */
  const showOnly = useCallback((type: ConnectionType) => {
    set(new Set(CONNECTION_TYPES.filter((other) => other !== type)))
  }, [])

  const showAll = useCallback(() => set(new Set()), [])

  return { hidden: current, toggle, showOnly, showAll }
}
