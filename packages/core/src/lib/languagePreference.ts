/**
 * Which language a viewer reads the app in, and which language AI writes to
 * them in. Pure, pinned by `languagePreference.test.ts`.
 *
 * The two are separate settings on purpose: someone can want the app in Greek
 * and the recommendations, the Watcher Identity, playlist text and the
 * assistant in English (or the other way round). Each is stored on the
 * viewer's UI preferences as an override; absent or null means the instance
 * default the admin chose, which is what every viewer had before overrides
 * existed and is what an absent value must keep meaning.
 *
 * The AI side has one more value, `AI_LANGUAGE_FOLLOWS_APP`, meaning "write
 * to me in whatever language I read the app in". It is a stored choice, never
 * the reading of an absent one, so switching the app language from the header
 * moves AI text along with it only for viewers who asked for that.
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
 * Following the app falls back to the AI default when the app language is not
 * one the admin enabled for AI output — never to the app language anyway, or
 * an admin who disabled a language for AI would see it used regardless.
 */
export function resolveAiLanguage(
  aiPref: string | null | undefined,
  uiLanguage: AppLocaleCode,
  defaults: LanguageDefaults
): AppLocaleCode {
  if (aiPref === AI_LANGUAGE_FOLLOWS_APP) {
    return defaults.enabledAiLanguages.includes(uiLanguage) ? uiLanguage : defaults.defaultAiLanguage
  }
  if (isValidAppLocale(aiPref) && defaults.enabledAiLanguages.includes(aiPref)) return aiPref
  return defaults.defaultAiLanguage
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
