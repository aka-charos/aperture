/**
 * The flag drawn for each app language. Pinned by `localeFlags.test.ts`.
 *
 * A flag names a country and a language is not one, so this is a convention
 * rather than a claim: each language gets the flag of the country most readers
 * associate with it. That is why the language switcher never shows a flag
 * alone in a list — the native name sits beside it. Only the closed app bar
 * button shows a flag by itself, and its tooltip names the language.
 *
 * Flags are SVG (`country-flag-icons`), never emoji: Windows renders flag
 * emoji as two bare letters ("GR"), which is most of the people reading this.
 */
export const LOCALE_FLAG_COUNTRY: Readonly<Record<string, string>> = {
  en: 'GB',
  es: 'ES',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  pt: 'PT',
  nl: 'NL',
  ru: 'RU',
  ja: 'JP',
  zh: 'CN',
  ko: 'KR',
  hi: 'IN',
  ar: 'SA',
  el: 'GR',
}

/** The country code whose flag stands for `locale`, or null when none is mapped. */
export function flagCountryFor(locale: string | null | undefined): string | null {
  if (!locale) return null
  const base = locale.split(/[-_]/)[0]?.toLowerCase() ?? ''
  return LOCALE_FLAG_COUNTRY[base] ?? null
}
