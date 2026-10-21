import { useSyncExternalStore } from 'react'
import type { ColorMode } from '@/theme'

/**
 * Light or dark, chosen per BROWSER.
 *
 * Deliberately not an account preference: those live in `user_settings`, whose
 * `updated_at` the recommendation activity gate reads, so flipping the theme
 * would regenerate that person's recommendations. It is also a choice about the
 * screen in front of someone as much as about them — a phone at night and a
 * desk monitor by day may want different answers.
 *
 * Not in `clientCaches.ts` either: it holds no user's data, so signing out or
 * viewing as someone else must not reset it.
 *
 * Absent means dark, which is what every instance looked like before the light
 * mode existed.
 */
const STORAGE_KEY = 'aperture-color-mode'
export const DEFAULT_COLOR_MODE: ColorMode = 'dark'

/** Pure: a stored value, read defensively. Anything unrecognised is "no choice". */
export function parseColorMode(raw: unknown): ColorMode | null {
  return raw === 'light' || raw === 'dark' ? raw : null
}

function readStored(): ColorMode {
  try {
    return parseColorMode(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_COLOR_MODE
  } catch {
    // Storage blocked (private mode, site data off): the default, every time.
    return DEFAULT_COLOR_MODE
  }
}

let mode: ColorMode = typeof window === 'undefined' ? DEFAULT_COLOR_MODE : readStored()
const listeners = new Set<() => void>()

/**
 * What the browser chrome and native controls are told: the page colour for
 * the mobile address bar, and `color-scheme` so form controls and scrollbars
 * the theme does not style match the page.
 */
function applyToDocument(next: ColorMode) {
  if (typeof document === 'undefined') return
  document.documentElement.style.colorScheme = next
  document.documentElement.dataset.colorMode = next
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', next === 'light' ? '#ffffff' : '#0f0f0f')
}
applyToDocument(mode)

export function getColorMode(): ColorMode {
  return mode
}

export function setColorMode(next: ColorMode): void {
  if (next === mode) return
  mode = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not remembered, but still applied for this visit.
  }
  applyToDocument(next)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current mode, re-rendering the caller when it changes. */
export function useColorMode(): ColorMode {
  return useSyncExternalStore(subscribe, getColorMode, () => DEFAULT_COLOR_MODE)
}
