import { isRtlLocale } from './localeDirection'
import i18n from './config'

function applyDocumentLangAndDir(lng: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lng
  document.documentElement.dir = isRtlLocale(lng) ? 'rtl' : 'ltr'
}

/** Applies a resolved locale to i18next and the document `<html lang>` / `dir`. */
export async function applyEffectiveUiLanguage(lng: string): Promise<void> {
  await i18n.changeLanguage(lng)
  applyDocumentLangAndDir(lng)
}

/**
 * Loads the signed-in user's effective UI language from the API and applies it.
 * Call after login and whenever server-side language preferences may have changed.
 */
export async function syncUiLanguageFromServer(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/me/preferences', { credentials: 'include' })
    if (!res.ok) return null
    const prefs = (await res.json()) as { effectiveUiLanguage?: string }
    const lng = prefs.effectiveUiLanguage
    if (lng && typeof lng === 'string') {
      await applyEffectiveUiLanguage(lng)
      return lng
    }
  } catch {
    // ignore
  }
  return null
}

/** The language facts a preferences save answers with (all decided by the API). */
export interface LanguagePreferencesResponse {
  uiLanguage?: string | null
  aiLanguage?: string | null
  aiFollowsApp?: boolean
  effectiveUiLanguage?: string
  effectiveAiLanguage?: string
  aiLanguageFollowingApp?: string
}

/**
 * Save the app and/or recommendations language. The one place either is
 * written from the client — the app-bar switcher and the login page both call
 * it — so a failure is told apart the same way everywhere: null means not
 * saved (refused, or no answer), and the caller decides what to put back.
 */
export async function saveLanguagePreferences(body: {
  uiLanguage?: string
  aiLanguage?: string | null
}): Promise<LanguagePreferencesResponse | null> {
  try {
    const res = await fetch('/api/auth/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return (await res.json()) as LanguagePreferencesResponse
  } catch {
    return null
  }
}

/** The language the page is showing right now: the one place this is read. */
export function shownLanguage(): string {
  return i18n.resolvedLanguage || i18n.language
}
