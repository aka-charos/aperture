import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en/translation.json'
import enOverrides from './overrides.en.json'
import { isRtlLocale } from './localeDirection'
import { createLocaleBackend } from './localeLoaders'
import { baseLanguage } from './languageSwitch'
import { REFRESH_EVENT, inlineEditPostProcessor } from './inlineEdit/store'

const i18nInit = i18n
  .use(LanguageDetector)
  // Every language but English arrives through this, and `changeLanguage` waits
  // for it, so a language is on screen only once its strings are.
  .use(createLocaleBackend())
  .use(initReactI18next)
  // Registered always, but only listed in `postProcess` while an admin has
  // inline text editing on (inlineEdit/store.ts), so it costs nothing at rest.
  .use(inlineEditPostProcessor)
  .init({
    react: {
      useSuspense: false,
      // REFRESH_EVENT re-renders every translated component when inline
      // editing switches on or saves a string, so the index of what is on
      // screen fills and the new text shows without a reload.
      bindI18n: `languageChanged ${REFRESH_EVENT}`,
    },
    // `resources` plus a backend is only allowed to mean "some are bundled, ask
    // for the rest" with this flag; without it the backend is never consulted.
    partialBundledLanguages: true,
    // A chunk that failed is asked for again on the next switch to it, not here on
    // a timer: each retry would hold the switch up, for a file a deploy has removed.
    maxRetries: 0,
    // Cloned rather than handed over directly: addResourceBundle(deep=true)
    // (used by applyRuntimeOverrides below) mutates the stored resource
    // object in place, and JSON module imports are singletons — without
    // cloning, any other module that imports the same locale file (e.g. the
    // admin Translations page reading "the bundled default") would see
    // runtime overrides bleed into what should be the pristine default.
    // The backend clones what it fetches for the same reason.
    resources: {
      en: { translation: structuredClone(en) },
    },
    fallbackLng: 'en',
    supportedLngs: [
      'en',
      'es',
      'de',
      'fr',
      'it',
      'pt',
      'nl',
      'ru',
      'ja',
      'zh',
      'ko',
      'hi',
      'ar',
      'el',
    ],
    interpolation: {
      escapeValue: false,
      // Every brand-facing string says `{{appName}}` rather than the product
      // name, so an operator can rename the instance and have all 14 locales
      // follow. Seeded with the default here and overwritten once
      // `/api/branding` answers (see lib/branding.ts) — without a seed the
      // placeholder would render raw for the first frame.
      defaultVariables: { appName: 'Aperture' },
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
      // Plain codes, or `en-GB, en-US, el` picks Greek: i18next finds no file for
      // the first two and takes the first exact match further down the list.
      convertDetectedLanguage: baseLanguage,
    },
  })

// Local English string overrides bundled at build time. Deep-merged over the
// bundled defaults so `locales/en/translation.json` stays pristine
// (upstream-owned, conflict-free). Put only the keys you want to change in
// `overrides.en.json`.
i18n.addResourceBundle('en', 'translation', enOverrides, true, true)

/**
 * Redraw every translated string in place, for strings or variables that changed
 * under them. Never `changeLanguage(i18n.language)`: i18next applies only the
 * latest `changeLanguage`, so that "same language" call landing while a switch
 * waits on its locale chunk would cancel the switch.
 */
export function redrawTranslatedText(): void {
  i18n.emit(REFRESH_EVENT)
}

/**
 * Merge strings into a language already in memory, and redraw. Refused for one
 * that is not: i18next fetches a language only while it has no bundle at all, so
 * a few strings written early would stand in for the whole file from then on.
 * Answers whether they went in.
 */
export function mergeLoadedStrings(lng: string, strings: object): boolean {
  if (!i18n.hasResourceBundle(lng, 'translation')) return false
  i18n.addResourceBundle(lng, 'translation', strings, true, true)
  redrawTranslatedText()
  return true
}

// Runtime string overrides served from a mounted directory on the server
// (GET /api/i18n/overrides/:lng → I18N_OVERRIDES_DIR/overrides.<lng>.json).
// These deep-merge on top of everything above, so operators can customize UI
// strings via a Docker volume without rebuilding the image. Applied per-locale,
// lazily, the first time a locale becomes active.
const runtimeOverridesApplied = new Set<string>()

async function applyRuntimeOverrides(rawLng: string | undefined): Promise<void> {
  const lng = (rawLng || 'en').split('-')[0]
  if (runtimeOverridesApplied.has(lng)) return
  runtimeOverridesApplied.add(lng) // mark first so re-entrant events don't refetch
  try {
    const res = await fetch(`/api/i18n/overrides/${encodeURIComponent(lng)}`, {
      credentials: 'include',
    })
    if (!res.ok) return
    const data: unknown = await res.json()
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0) {
      mergeLoadedStrings(lng, data)
    }
  } catch {
    // Overrides are optional; ignore network/parse errors.
  }
}

// Pick up overrides whenever a new locale becomes active.
i18n.on('languageChanged', (lng: string) => {
  void applyRuntimeOverrides(lng)
})

void i18nInit.then(() => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = i18n.language
    document.documentElement.dir = isRtlLocale(i18n.language) ? 'rtl' : 'ltr'
  }
  void applyRuntimeOverrides(i18n.language)
})

/** How long a first paint waits on a locale chunk before drawing English. */
const FIRST_LANGUAGE_WAIT_MS = 8000

/**
 * The viewer's language is ready to draw (or has taken too long). Waited for
 * before the first render so a viewer reading Greek or Arabic never sees a flash
 * of left-to-right English; immediate for English. A chunk slower than the limit
 * still arrives and re-renders.
 */
export function firstLanguageReady(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FIRST_LANGUAGE_WAIT_MS)
    const finish = () => {
      clearTimeout(timer)
      resolve()
    }
    void i18nInit.then(finish, finish)
  })
}

export default i18n
