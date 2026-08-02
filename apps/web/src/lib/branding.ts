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

/** Artwork bundled in the image, used unless the operator mounted their own. */
export const DEFAULT_LOGO_URL = '/aperture.svg'
/** Raster fallback for the one place that draws the logo large. */
export const DEFAULT_LOGO_RASTER_URL = '/aperture.png'

let logoUrl: string | null = null

/** The mounted logo's URL, or null when the bundled artwork is in use. */
export function getCustomLogoUrl(): string | null {
  return logoUrl
}

function setCustomLogoUrl(url: string | null): void {
  if (url === logoUrl) return
  logoUrl = url
  emit()
}

interface BrandingResponse {
  appName?: unknown
  logo?: { url?: unknown } | null
}

/**
 * Load the configured name and any mounted artwork. Called once at startup,
 * before the app renders, and again after an admin saves.
 *
 * One request covers both: the logo is only ever needed alongside the name, and
 * a second round trip would buy nothing.
 *
 * Failure is silent and leaves the defaults in place: an unreachable API is
 * already going to be obvious from the page itself, and a blank brand would be
 * a worse way to find out.
 */
export async function loadBranding(): Promise<void> {
  try {
    const response = await fetch('/api/branding', { credentials: 'include' })
    if (!response.ok) return
    const data = (await response.json()) as BrandingResponse | null
    if (!data || typeof data !== 'object') return

    if (typeof data.appName === 'string') {
      setAppName(data.appName)
    }
    setCustomLogoUrl(typeof data.logo?.url === 'string' ? data.logo.url : null)
  } catch {
    // Keep the defaults.
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

/**
 * The logo to draw. Resolves to the bundled artwork until (and unless) the
 * branding call reports a mounted file, so nothing flashes an empty box.
 */
export function useLogoUrl(fallback: string = DEFAULT_LOGO_URL): string {
  return useSyncExternalStore(subscribe, getCustomLogoUrl, getCustomLogoUrl) ?? fallback
}
