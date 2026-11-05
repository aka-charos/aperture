import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInstance } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { LAZY_LOCALES, createLocaleBackend, type loadLocaleTree } from './localeLoaders'
import { baseLanguage, switchLanguage } from './languageSwitch'
import type { TranslationTree } from './flatten'

type Load = typeof loadLocaleTree

/** A locale chunk that arrives when the test says so. */
function deferredLoad() {
  let release: (tree: TranslationTree) => void = () => {}
  let fail: (error: Error) => void = () => {}
  const pending = new Promise<TranslationTree>((res, rej) => {
    release = res
    fail = rej
  })
  const load: Load = () => pending
  return { load, release: (tree: TranslationTree) => release(tree), fail: (error: Error) => fail(error) }
}

/** Set up the way i18n/config.ts does: English bundled, the rest on demand. */
async function startI18n(load: Load) {
  const i18n = createInstance({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'el', 'fr'],
    partialBundledLanguages: true,
    maxRetries: 0,
    resources: { en: { translation: { hello: 'Hello', only: 'English only' } } },
    interpolation: { escapeValue: false },
  })
  i18n.use(createLocaleBackend(load))
  await i18n.init()
  return i18n
}

const nextTurn = () => new Promise((res) => setTimeout(res, 0))

test('every locale directory but English has a loader', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const onDisk = readdirSync(resolve(here, 'locales'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((code) => code !== 'en')
    .sort()
  assert.deepEqual([...LAZY_LOCALES].sort(), onDisk)
})

test('a language goes on screen only once its strings are in', async () => {
  const chunk = deferredLoad()
  const i18n = await startI18n(chunk.load)

  const switching = i18n.changeLanguage('el')
  await nextTurn()
  assert.equal(i18n.language, 'en', 'still the old language while the chunk is on its way')
  assert.equal(i18n.t('hello'), 'Hello')

  chunk.release({ hello: 'Γεια' })
  await switching
  assert.equal(i18n.language, 'el')
  assert.equal(i18n.t('hello'), 'Γεια')
  assert.equal(i18n.t('only'), 'English only', 'a key the locale lacks falls back to English')
})

test('i18next holds a copy, so runtime overrides cannot reach what the Translations page reads', async () => {
  const shipped: TranslationTree = { nested: { hello: 'Γεια' } }
  const i18n = await startI18n(async () => shipped)

  await i18n.changeLanguage('el')
  i18n.addResourceBundle('el', 'translation', { nested: { hello: 'Overridden' } }, true, true)

  assert.equal(i18n.t('nested.hello'), 'Overridden')
  assert.deepEqual(shipped, { nested: { hello: 'Γεια' } })
})

test('a chunk that fails leaves the viewer reading English, not stuck', async () => {
  const chunk = deferredLoad()
  const i18n = await startI18n(chunk.load)
  const switching = i18n.changeLanguage('el')
  chunk.fail(new Error('404'))
  await switching
  assert.equal(i18n.t('hello'), 'Hello')
  assert.equal(i18n.resolvedLanguage, 'en', 'what is on screen is English, and says so')
})

// The two reasons for `redrawTranslatedText` and `mergeLoadedStrings` in config.ts:
// both are i18next behaviour that only matters now that a switch takes time.
test('a same-language changeLanguage during a switch cancels the switch', async () => {
  const chunk = deferredLoad()
  const i18n = await startI18n(chunk.load)

  const switching = i18n.changeLanguage('el')
  await i18n.changeLanguage(i18n.language)
  chunk.release({ hello: 'Γεια' })
  await switching

  assert.equal(i18n.language, 'en', 'why nothing may nudge a redraw with changeLanguage')
})

test('a few strings written before the file arrives stand in for the whole file', async () => {
  let asked = 0
  const i18n = await startI18n(async () => {
    asked += 1
    return { hello: 'Γεια' }
  })

  i18n.addResource('el', 'translation', 'only', 'Early')
  await i18n.changeLanguage('el')

  assert.equal(asked, 0, 'why nothing may write to a language that is not in memory')
  assert.equal(i18n.t('hello'), 'Hello')
})

test('a language that failed is read again the next time it is chosen', async () => {
  let reads = 0
  const i18n = await startI18n(async () => {
    reads += 1
    if (reads === 1) throw new Error('offline')
    return { hello: 'Γεια' }
  })

  assert.equal(await switchLanguage(i18n, 'el'), 'failed')
  assert.equal(reads, 1, 'no retries on a timer')
  assert.equal(await switchLanguage(i18n, 'el'), 'applied')
  assert.equal(reads, 2)
  assert.equal(i18n.t('hello'), 'Γεια')
})

test('a failed language does not stay current with no strings, so Arabic cannot go right-to-left in English', async () => {
  const i18n = await startI18n(async () => {
    throw new Error('offline')
  })
  assert.equal(await switchLanguage(i18n, 'el'), 'failed')
  assert.equal(i18n.language, 'en')
})

test('a switch overtaken by a later one says so, whichever chunk lands first', async () => {
  const greek = deferredLoad()
  const french = deferredLoad()
  const i18n = await startI18n((code) => (code === 'el' ? greek.load(code) : french.load(code)))

  const first = switchLanguage(i18n, 'el')
  const second = switchLanguage(i18n, 'fr')
  french.release({ hello: 'Bonjour' })
  assert.equal(await second, 'applied')
  greek.release({ hello: 'Γεια' })
  assert.equal(await first, 'replaced')
  assert.equal(i18n.language, 'fr')
})

test('a switch to a language already there is applied at once', async () => {
  const i18n = await startI18n(async () => null)
  assert.equal(await switchLanguage(i18n, 'en'), 'applied')
})

/** The real detector over a given browser list, as config.ts sets it up. */
async function detectFrom(browserList: string[], convertDetectedLanguage?: (code: string) => string) {
  const i18n = createInstance()
  i18n.use(LanguageDetector).use(createLocaleBackend(async () => ({ hello: 'translated' })))
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'el', 'pt', 'zh'],
    partialBundledLanguages: true,
    maxRetries: 0,
    resources: { en: { translation: { hello: 'Hello' } } },
    detection: { order: ['fixture'], caches: [], ...(convertDetectedLanguage ? { convertDetectedLanguage } : {}) },
  })
  const detector = i18n.services.languageDetector as LanguageDetector
  detector.addDetector({ name: 'fixture', lookup: () => browserList })
  await i18n.changeLanguage()
  return i18n.language
}

test('a browser preferring regional English gets English, not an exact match further down its list', async () => {
  assert.equal(await detectFrom(['en-GB', 'en-US', 'el']), 'el', 'why plain codes are needed')
  assert.equal(await detectFrom(['en-GB', 'en-US', 'el'], baseLanguage), 'en')
})

test('plain codes still find a regional language, and the first supported one wins', async () => {
  assert.equal(await detectFrom(['pt-BR', 'en'], baseLanguage), 'pt')
  assert.equal(await detectFrom(['zh-TW'], baseLanguage), 'zh')
  assert.equal(await detectFrom(['fi-FI', 'el-GR', 'en'], baseLanguage), 'el')
})

test('the app sets i18next up the way these tests do', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const config = readFileSync(resolve(here, 'config.ts'), 'utf8')
  assert.match(config, /maxRetries: 0/)
  assert.match(config, /convertDetectedLanguage: baseLanguage/)
})
