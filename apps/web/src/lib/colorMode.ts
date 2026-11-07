import { useSyncExternalStore } from 'react'
import { APPEARANCES, documentChromeColor, type Appearance } from '@/theme'

/**
 * Light, Black or Dark, chosen per BROWSER.
 *
 * Deliberately not an account preference: those live in `user_settings`, whose
 * `updated_at` the recommendation activity gate reads, so changing appearance
 * would regenerate that person's recommendations. It is also a choice about the
 * screen in front of someone as much as about them — a phone at night and a
 * desk monitor by day may want different answers.
 *
 * Not in `clientCaches.ts` either: it holds no user's data, so signing out or
 * viewing as someone else must not reset it.
 *
 * Absent means Black, which is what every instance looked like before any choice
 * existed.
 */
const STORAGE_KEY = 'aperture-appearance'
/** What this choice used to be stored as, where 'dark' meant today's Black. */
const LEGACY_MODE_KEY = 'aperture-color-mode'
const LEGACY_THEME_KEY = 'aperture-ui-theme'
export const DEFAULT_APPEARANCE: Appearance = 'black'
/** What a full-page dark stage (the sign-in page) shows under Light. */
export const FULL_PAGE_DARK_STAGE: Appearance = 'black'

/** Pure: a stored value, read defensively. Anything unrecognised is "no choice". */
export function parseAppearance(raw: unknown): Appearance | null {
  return APPEARANCES.find((appearance) => appearance === raw) ?? null
}

/**
 * Pure: what someone chose before there were three, so nobody's look changes.
 * The old 'dark' is NOT today's Dark unless they had also picked Studio. "Follow
 * device" no longer exists; it lands on the dark look they had.
 */
export function appearanceFromLegacy(mode: unknown, theme: unknown): Appearance {
  if (mode === 'light') return 'light'
  return theme === 'studio' ? 'dark' : 'black'
}

/** Pure: where the app bar's one button goes next. */
export function nextAppearance(current: Appearance): Appearance {
  return APPEARANCES[(APPEARANCES.indexOf(current) + 1) % APPEARANCES.length]
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Storage blocked (private mode, site data off): the default, every time.
    return null
  }
}

function readAppearance(): Appearance {
  return parseAppearance(readStored(STORAGE_KEY)) ?? appearanceFromLegacy(readStored(LEGACY_MODE_KEY), readStored(LEGACY_THEME_KEY))
}

const hasWindow = typeof window !== 'undefined'
let appearance: Appearance = hasWindow ? readAppearance() : DEFAULT_APPEARANCE
const listeners = new Set<() => void>()
/** Full-page dark stages on screen (the sign-in page); see `holdDarkDocument`. */
let darkHolds = 0

/**
 * What the browser chrome and native controls are told: the page colour for
 * the mobile address bar, and `color-scheme` so form controls and scrollbars
 * the theme does not style match the page. A full-page dark stage wins over a
 * Light choice, or that puts a white address bar and light native controls on a
 * page that is dark from edge to edge.
 */
function applyToDocument() {
  if (typeof document === 'undefined') return
  const shown: Appearance = darkHolds > 0 && appearance === 'light' ? FULL_PAGE_DARK_STAGE : appearance
  const root = document.documentElement
  root.style.colorScheme = shown === 'light' ? 'light' : 'dark'
  root.dataset.appearance = shown
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', documentChromeColor(shown))
}
applyToDocument()

function adopt(next: Appearance) {
  if (next === appearance) return
  appearance = next
  applyToDocument()
  for (const listener of listeners) listener()
}

// Another tab's choice. `storage` fires in every OTHER tab of this origin, so
// without it two open tabs disagree, and the next press in the stale one moves
// on from the wrong place.
if (hasWindow) {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) adopt(readAppearance())
  })
}

export function getAppearance(): Appearance {
  return appearance
}

export function setAppearance(next: Appearance): void {
  if (next === appearance) return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not remembered, but still applied for this visit.
  }
  adopt(next)
}

/**
 * Tell the browser the whole page is dark while a full-page dark stage is
 * mounted, whatever the chosen appearance. Returns the release; holds are
 * counted, so overlapping stages release cleanly.
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

/** The current appearance, re-rendering the caller when it changes. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance, () => DEFAULT_APPEARANCE)
}
