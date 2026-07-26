/**
 * The assistant's current work phase ("Scouting for candidates…").
 *
 * The server reports phases as transient `data-status` parts on the chat stream.
 * They arrive in `useChatRuntime({ onData })` (AssistantChatSurface) but are
 * needed in `LoadingIndicator` (Thread) — a leaf deep inside the runtime
 * provider. They deliberately cannot be rendered as message parts:
 * @assistant-ui/react converts `data-*` parts and then renders them as null, so
 * there is no component slot to hook into.
 *
 * A module-level store keeps the two ends in step without threading state
 * through the provider, matching the sibling `unwatchedPreference.ts`. Not
 * persisted: a phase is meaningless the moment the turn ends.
 *
 * The value is an i18n key fragment from the server's StatusPhase union, not
 * text; the renderer resolves `assistant.status.<phase>`.
 */
import { useSyncExternalStore } from 'react'

let current: string | null = null
const listeners = new Set<() => void>()

export function getStatusPhase(): string | null {
  return current
}

/** Set the live phase, or `null` to fall back to the generic "Thinking…". */
export function setStatusPhase(phase: string | null): void {
  if (current === phase) return
  current = phase
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Read the current phase in a component; re-renders when it changes. */
export function useStatusPhase(): string | null {
  return useSyncExternalStore(subscribe, getStatusPhase, getStatusPhase)
}
