/**
 * Which language a viewer reads the app in, and which language AI writes to
 * them in. Pure, pinned by `languagePreference.test.ts`.
 *
 * The two are separate settings on purpose: someone can want the app in Greek
 * and the recommendations, the Watcher Identity, playlist text and the
 * assistant in English (or the other way round). Each is stored on the
 * viewer's UI preferences as an override.
 *
 * An absent app language means the instance default. An absent
 * recommendations language means FOLLOW THE APP — the same as the explicit
 * `AI_LANGUAGE_FOLLOWS_APP`. That is a deliberate departure from "absent keeps
 * the old meaning" (it used to mean the admin's AI default): once the app
 * language became a flag anyone flips from the top bar, recommendations that
 * stayed behind read as a bug to the first person who tried it. Only a viewer
 * who never chose a recommendations language AND reads the app in a language
 * other than the AI default moves; anyone who chose one keeps it. The admin's
 * AI default is now the fallback for an app language that is not enabled for
 * AI output.
 */
import { isValidAppLocale, type AppLocaleCode } from './locales.js'

/** Stored `aiLanguage` value meaning "the same language as the app". */
export const AI_LANGUAGE_FOLLOWS_APP = 'app' as const

export interface LanguageDefaults {
  defaultUiLanguage: AppLocaleCode
  defaultAiLanguage: AppLocaleCode
  enabledUiLanguages: readonly AppLocaleCode[]
  enabledAiLanguages: readonly AppLocaleCode[]
}

/** The viewer's override if it is a language the admin still offers, else the default. */
export function resolveUiLanguage(
  uiPref: string | null | undefined,
  defaults: LanguageDefaults
): AppLocaleCode {
  if (isValidAppLocale(uiPref) && defaults.enabledUiLanguages.includes(uiPref)) return uiPref
  return defaults.defaultUiLanguage
}

/**
 * The language AI writes to this viewer in.
 *
 * Absent and `AI_LANGUAGE_FOLLOWS_APP` both follow the app. Following falls
 * back to the AI default when the app language is not one the admin enabled
 * for AI output — never to the app language anyway, or an admin who disabled
 * a language for AI would see it used regardless. An explicit language the
 * admin has since disabled also falls back to the AI default, not to the app:
 * that viewer did choose, just something no longer offered.
 */
export function resolveAiLanguage(
  aiPref: string | null | undefined,
  uiLanguage: AppLocaleCode,
  defaults: LanguageDefaults
): AppLocaleCode {
  if (aiPref == null || aiPref === AI_LANGUAGE_FOLLOWS_APP) {
    return defaults.enabledAiLanguages.includes(uiLanguage) ? uiLanguage : defaults.defaultAiLanguage
  }
  if (isValidAppLocale(aiPref) && defaults.enabledAiLanguages.includes(aiPref)) return aiPref
  return defaults.defaultAiLanguage
}

/** True when the stored choice follows the app language (absent included). */
export function aiLanguageFollowsApp(aiPref: string | null | undefined): boolean {
  return aiPref == null || aiPref === AI_LANGUAGE_FOLLOWS_APP
}

/**
 * What the stored recommendations language becomes when the app language
 * changes from `previousUi` to `nextUi` and the same save names no
 * recommendations language of its own: `AI_LANGUAGE_FOLLOWS_APP` when the
 * stored choice is an explicit language that resolved to the OLD app language,
 * otherwise `undefined` (leave it alone).
 *
 * Recommendations that matched the app keep matching it, even when that match
 * was an explicit choice — the switcher shows such a viewer the app's own
 * language pressed, so leaving them behind would contradict what they saw. A
 * deliberate split (Greek app, English recommendations) stays put. It lives
 * here, applied by the save route, so every writer of the app language — the
 * app-bar flag, the login page, anything later — gets the same answer.
 */
export function aiLanguageAfterAppChange(
  storedAi: string | null | undefined,
  previousUi: AppLocaleCode,
  nextUi: AppLocaleCode,
  defaults: LanguageDefaults
): typeof AI_LANGUAGE_FOLLOWS_APP | undefined {
  if (previousUi === nextUi || aiLanguageFollowsApp(storedAi)) return undefined
  return resolveAiLanguage(storedAi, previousUi, defaults) === previousUi ? AI_LANGUAGE_FOLLOWS_APP : undefined
}

/**
 * Why a requested override cannot be stored, or null when it can. `null` (back
 * to the default) is always allowed. A language the admin has not enabled is
 * refused rather than stored: the resolver would ignore it, so saving it would
 * hand back a choice that looks made and does nothing.
 */
export function languagePreferenceRefusal(
  field: 'uiLanguage' | 'aiLanguage',
  value: unknown,
  defaults: LanguageDefaults
): string | null {
  if (value === null || value === undefined) return null
  if (field === 'aiLanguage' && value === AI_LANGUAGE_FOLLOWS_APP) return null
  if (typeof value !== 'string' || !isValidAppLocale(value)) {
    return `Unsupported language: ${String(value)}`
  }
  const enabled = field === 'uiLanguage' ? defaults.enabledUiLanguages : defaults.enabledAiLanguages
  if (!enabled.includes(value)) return `Language not enabled on this server: ${value}`
  return null
}
