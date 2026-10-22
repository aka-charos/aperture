import { useSyncExternalStore } from 'react'
import { documentChromeColor, type ColorMode } from '@/theme'

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
/** Full-page dark stages on screen (the sign-in page); see `holdDarkDocument`. */
let darkHolds = 0

/**
 * What the browser chrome and native controls are told: the page colour for
 * the mobile address bar, and `color-scheme` so form controls and scrollbars
 * the theme does not style match the page. A full-page dark stage wins over
 * the chosen mode, or a light choice puts a white address bar and light native
 * controls on a page that is dark from edge to edge.
 */
function applyToDocument() {
  if (typeof document === 'undefined') return
  const shown: ColorMode = darkHolds > 0 ? 'dark' : mode
  document.documentElement.style.colorScheme = shown
  document.documentElement.dataset.colorMode = shown
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', documentChromeColor(shown))
}
applyToDocument()

function adopt(next: ColorMode) {
  if (next === mode) return
  mode = next
  applyToDocument()
  for (const listener of listeners) listener()
}

// Another tab's choice. `storage` fires in every OTHER tab of this origin, so
// without it two open tabs disagree, and the next press in the stale one flips
// from the wrong side.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) adopt(readStored())
  })
}

export function getColorMode(): ColorMode {
  return mode
}

export function setColorMode(next: ColorMode): void {
  if (next === mode) return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not remembered, but still applied for this visit.
  }
  adopt(next)
}

/**
 * Tell the browser the whole page is dark while a full-page dark stage is
 * mounted, whatever the chosen mode. Returns the release; holds are counted,
 * so overlapping stages release cleanly.
 */
export function holdDarkDocument(): () => void {
  darkHolds++
  applyToDocument()
  let released = false
  return () => {
    if (released) return
    released = true
    darkHolds--
    applyToDocument()
  }
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
