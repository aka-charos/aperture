/**
 * "Only suggest what I haven't watched" — the chat composer toggle.
 *
 * Lives outside React because two unrelated places need it: the composer
 * (which renders it) and the chat transport (which is constructed once per
 * conversation mount and reads the current value on every send). A module-level
 * store with useSyncExternalStore keeps both in step without threading state
 * through the runtime provider.
 *
 * Persisted per browser: a viewing preference should survive a reload, and it
 * is not worth a server round trip.
 */
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'aperture.assistant.unwatchedOnly'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

let current = readStored()
const listeners = new Set<() => void>()

export function getUnwatchedOnly(): boolean {
  return current
}

export function setUnwatchedOnly(value: boolean): void {
  if (current === value) return
  current = value
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false')
  } catch {
    // Private mode / storage disabled — the in-memory value still applies.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Read the toggle in a component; re-renders when it changes anywhere. */
export function useUnwatchedOnly(): boolean {
  return useSyncExternalStore(subscribe, getUnwatchedOnly, getUnwatchedOnly)
}
