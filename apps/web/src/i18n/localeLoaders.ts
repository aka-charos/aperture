/**
 * The non-English translation files, one chunk each, and the i18next backend
 * that fetches them.
 *
 * Together they are several times the rest of the first download and a viewer
 * reads one of them, so nothing imports them statically: `routeImports.test.ts`
 * fails on a static import of any locale but English. English stays in the entry
 * chunk because it is the fallback for every missing key, and the one language
 * that is there before anything has been fetched.
 *
 * A dynamic import has to name its file for the bundler to find it, hence a
 * list rather than a template string.
 */
import type { BackendModule } from 'i18next'
import type { TranslationTree } from './flatten'

const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  es: () => import('./locales/es/translation.json'),
  de: () => import('./locales/de/translation.json'),
  fr: () => import('./locales/fr/translation.json'),
  it: () => import('./locales/it/translation.json'),
  pt: () => import('./locales/pt/translation.json'),
  nl: () => import('./locales/nl/translation.json'),
  ru: () => import('./locales/ru/translation.json'),
  ja: () => import('./locales/ja/translation.json'),
  zh: () => import('./locales/zh/translation.json'),
  ko: () => import('./locales/ko/translation.json'),
  hi: () => import('./locales/hi/translation.json'),
  ar: () => import('./locales/ar/translation.json'),
  el: () => import('./locales/el/translation.json'),
}

/** Every language that arrives on demand: all of them but English. */
export const LAZY_LOCALES: readonly string[] = Object.keys(LOADERS)

/**
 * A locale's shipped strings, or null when it has no file. The object is the
 * module's own, shared with every other reader, and must not be written to:
 * the Translations page reads it as the pristine default. i18next gets a copy.
 */
export async function loadLocaleTree(code: string): Promise<TranslationTree | null> {
  const loader = LOADERS[code]
  if (!loader) return null
  return (await loader()).default as TranslationTree
}

/**
 * What `changeLanguage` waits on, so a language is on screen only once its
 * strings are. The copy matters: i18next keeps the object it is handed
 * (`skipCopy`), and deep-merging runtime overrides into it would otherwise edit
 * the module every other reader shares.
 *
 * A failure carries i18next's retry flag (`true` as the data), which with
 * `maxRetries: 0` in config.ts means no retries on a timer but a fresh read the next
 * time the language is chosen. Without it i18next marks the language failed for the
 * life of the tab and never asks again. Chrome keeps its own record of a failed
 * import and answers that read without a request, so there only a reload recovers,
 * which is why the language menu's message says to reload.
 */
export function createLocaleBackend(load: typeof loadLocaleTree = loadLocaleTree): BackendModule {
  return {
    type: 'backend',
    init() {},
    read(language, _namespace, callback) {
      load(language.split('-')[0]).then(
        (tree) => callback(null, tree ? structuredClone(tree) : {}),
        (error: Error) => callback(error, true)
      )
    },
  }
}
