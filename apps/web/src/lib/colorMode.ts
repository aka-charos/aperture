import { useSyncExternalStore } from 'react'
import { documentChromeColor, type ColorMode, type UiTheme } from '@/theme'

/**
 * Light or dark, and which dark look (`UiTheme`), chosen per BROWSER.
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
 * Absent means Classic and dark, which is what every instance looked like before
 * either choice existed.
 */
const STORAGE_KEY = 'aperture-color-mode'
const THEME_STORAGE_KEY = 'aperture-ui-theme'
export const DEFAULT_COLOR_MODE: ColorMode = 'dark'
export const DEFAULT_UI_THEME: UiTheme = 'classic'

/** What was chosen, as against the mode that choice comes to right now. */
export type ColorModeChoice = ColorMode | 'system'

/** Pure: a stored value, read defensively. Anything unrecognised is "no choice". */
export function parseColorModeChoice(raw: unknown): ColorModeChoice | null {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : null
}

/** Pure: a stored theme. Anything unrecognised is the original look, never an opt-in. */
export function parseUiTheme(raw: unknown): UiTheme {
  return raw === 'studio' ? 'studio' : DEFAULT_UI_THEME
}

/** Pure: the mode a choice comes to on a device that does or does not prefer dark. */
export function resolveColorMode(choice: ColorModeChoice, deviceIsDark: boolean): ColorMode {
  if (choice !== 'system') return choice
  return deviceIsDark ? 'dark' : 'light'
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Storage blocked (private mode, site data off): the default, every time.
    return null
  }
}

const hasWindow = typeof window !== 'undefined'
const deviceDark = hasWindow && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

let choice: ColorModeChoice = (hasWindow && parseColorModeChoice(readStored(STORAGE_KEY))) || DEFAULT_COLOR_MODE
let uiTheme: UiTheme = hasWindow ? parseUiTheme(readStored(THEME_STORAGE_KEY)) : DEFAULT_UI_THEME
let mode: ColorMode = resolveColorMode(choice, deviceDark?.matches ?? true)
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
  document.documentElement.dataset.uiTheme = uiTheme
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', documentChromeColor(shown, uiTheme))
}
applyToDocument()

function adopt(nextChoice: ColorModeChoice, nextTheme: UiTheme) {
  const nextMode = resolveColorMode(nextChoice, deviceDark?.matches ?? true)
  if (nextChoice === choice && nextTheme === uiTheme && nextMode === mode) return
  choice = nextChoice
  uiTheme = nextTheme
  mode = nextMode
  applyToDocument()
  for (const listener of listeners) listener()
}

// Another tab's choice. `storage` fires in every OTHER tab of this origin, so
// without it two open tabs disagree, and the next press in the stale one flips
// from the wrong side.
if (hasWindow) {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === THEME_STORAGE_KEY || event.key === null) {
      adopt(parseColorModeChoice(readStored(STORAGE_KEY)) ?? DEFAULT_COLOR_MODE, parseUiTheme(readStored(THEME_STORAGE_KEY)))
    }
  })
}
// The device changing its mind. Only "Follow device" comes to anything different.
deviceDark?.addEventListener('change', () => adopt(choice, uiTheme))

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembered, but still applied for this visit.
  }
}

export function getColorMode(): ColorMode {
  return mode
}

export function getColorModeChoice(): ColorModeChoice {
  return choice
}

export function getUiTheme(): UiTheme {
  return uiTheme
}

export function setColorMode(next: ColorModeChoice): void {
  if (next === choice) return
  remember(STORAGE_KEY, next)
  adopt(next, uiTheme)
}

export function setUiTheme(next: UiTheme): void {
  if (next === uiTheme) return
  remember(THEME_STORAGE_KEY, next)
  adopt(choice, next)
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

/** What was chosen, for the control that chooses it. */
export function useColorModeChoice(): ColorModeChoice {
  return useSyncExternalStore(subscribe, getColorModeChoice, () => DEFAULT_COLOR_MODE)
}

/** The current theme, re-rendering the caller when it changes. */
export function useUiTheme(): UiTheme {
  return useSyncExternalStore(subscribe, getUiTheme, () => DEFAULT_UI_THEME)
}
