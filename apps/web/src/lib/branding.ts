import { useSyncExternalStore } from 'react'
import i18n from '@/i18n/config'

/**
 * The instance's display name.
 *
 * Almost nothing reads this directly. UI strings say `{{appName}}` and i18next
 * fills it in from `interpolation.defaultVariables`, so renaming the instance
 * rebrands every translated string in all 15 locales at once. This module is the
 * few places that can't go through a translation: image alt text and the
 * browser tab title.
 *
 * Duplicated from core's DEFAULT_APP_NAME on purpose — the web bundle never
 * imports @aperture/core (see CLAUDE.md).
 */
export const DEFAULT_APP_NAME = 'Aperture'

let appName = DEFAULT_APP_NAME
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/**
 * Point i18next at the new name and force a re-render.
 *
 * `defaultVariables` is read out of the shared options object every time a
 * string is interpolated, not cached at init, so assigning it late takes effect.
 * Strings already on screen won't reformat by themselves, hence the
 * changeLanguage nudge — the same one the runtime i18n overrides use.
 */
function applyToI18n(name: string) {
  const interpolation = i18n.options.interpolation ?? {}
  interpolation.defaultVariables = { ...interpolation.defaultVariables, appName: name }
  i18n.options.interpolation = interpolation
}

export function getAppName(): string {
  return appName
}

export function setAppName(name: string | null | undefined): void {
  const next = (name ?? '').trim() || DEFAULT_APP_NAME
  if (next === appName) return
  appName = next
  applyToI18n(next)
  if (typeof document !== 'undefined') document.title = next
  emit()
  void i18n.changeLanguage(i18n.language)
}

/**
 * Load the configured name. Called once at startup, before the app renders, and
 * again after an admin saves.
 *
 * Failure is silent and leaves the default in place: an unreachable API is
 * already going to be obvious from the page itself, and a blank brand would be
 * a worse way to find out.
 */
export async function loadAppName(): Promise<void> {
  try {
    const response = await fetch('/api/branding', { credentials: 'include' })
    if (!response.ok) return
    const data: unknown = await response.json()
    if (data && typeof data === 'object' && typeof (data as { appName?: unknown }).appName === 'string') {
      setAppName((data as { appName: string }).appName)
    }
  } catch {
    // Keep the default.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** For the handful of places that need the raw name rather than a translation. */
export function useAppName(): string {
  return useSyncExternalStore(subscribe, getAppName, getAppName)
}
