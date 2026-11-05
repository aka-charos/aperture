/**
 * Switching language now takes time, because the strings may have to be fetched.
 * So a caller has to be told what became of a switch before acting on it: saving a
 * pick to the account, say, when a later pick has already replaced it on screen.
 *
 * Takes the i18next instance rather than importing config.ts, whose module-level
 * setup a test has no use for.
 */
import type { i18n as I18n } from 'i18next'

/**
 * `applied`: on screen. `replaced`: another switch overtook this one. `failed`:
 * the strings could not be fetched, and the page has gone back to what it showed.
 */
export type LanguageOutcome = 'applied' | 'replaced' | 'failed'

/** `en-GB` -> `en`: every locale file here is keyed by its plain language code. */
export function baseLanguage(code: string): string {
  return code.split('-')[0]
}

export async function switchLanguage(i18n: I18n, lng: string): Promise<LanguageOutcome> {
  // What is on screen. `language` alone can name one whose strings never arrived.
  const shown = i18n.resolvedLanguage ?? i18n.language
  await i18n.changeLanguage(lng)
  // i18next applies only the latest call, so an overtaken one changes nothing here.
  if (baseLanguage(i18n.language) !== baseLanguage(lng)) return 'replaced'
  if (i18n.hasResourceBundle(i18n.language, 'translation')) return 'applied'
  // Otherwise the language is set with no strings: English words, and the page
  // right-to-left if the language was Arabic.
  if (shown && baseLanguage(shown) !== baseLanguage(lng)) await i18n.changeLanguage(shown)
  return 'failed'
}
