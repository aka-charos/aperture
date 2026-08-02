import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en/translation.json'
import es from './locales/es/translation.json'
import de from './locales/de/translation.json'
import fr from './locales/fr/translation.json'
import it from './locales/it/translation.json'
import pt from './locales/pt/translation.json'
import nl from './locales/nl/translation.json'
import ru from './locales/ru/translation.json'
import ja from './locales/ja/translation.json'
import zh from './locales/zh/translation.json'
import ko from './locales/ko/translation.json'
import hi from './locales/hi/translation.json'
import ar from './locales/ar/translation.json'
import he from './locales/he/translation.json'
import el from './locales/el/translation.json'
import enOverrides from './overrides.en.json'
import { isRtlLocale } from './localeDirection'

const i18nInit = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    react: {
      useSuspense: false,
    },
    resources: {
      en: { translation: en },
      es: { translation: es },
      de: { translation: de },
      fr: { translation: fr },
      it: { translation: it },
      pt: { translation: pt },
      nl: { translation: nl },
      ru: { translation: ru },
      ja: { translation: ja },
      zh: { translation: zh },
      ko: { translation: ko },
      hi: { translation: hi },
      ar: { translation: ar },
      he: { translation: he },
      el: { translation: el },
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
      'he',
      'el',
    ],
    interpolation: {
      escapeValue: false,
      // Every brand-facing string says `{{appName}}` rather than the product
      // name, so an operator can rename the instance and have all 15 locales
      // follow. Seeded with the default here and overwritten once
      // `/api/branding` answers (see lib/branding.ts) — without a seed the
      // placeholder would render raw for the first frame.
      defaultVariables: { appName: 'Aperture' },
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  })

// Local English string overrides bundled at build time. Deep-merged over the
// bundled defaults so `locales/en/translation.json` stays pristine
// (upstream-owned, conflict-free). Put only the keys you want to change in
// `overrides.en.json`.
i18n.addResourceBundle('en', 'translation', enOverrides, true, true)

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
      i18n.addResourceBundle(lng, 'translation', data, true, true)
      // Force react-i18next to re-render with the merged strings.
      void i18n.changeLanguage(i18n.language)
    }
  } catch {
    // Overrides are optional; ignore network/parse errors.
  }
}

// Pick up overrides whenever a new locale becomes active (guarded against loops).
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

export default i18n
