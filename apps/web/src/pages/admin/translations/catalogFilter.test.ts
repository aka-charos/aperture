import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideInlineSave, isUntranslated, keyMatchesFilter, type CatalogFilter } from './catalogFilter'

const data = {
  english: {
    'home.title': 'Home',
    'home.greeting': 'Hello {{name}}',
    'admin.title': 'Administration',
  },
  effective: {
    el: { 'home.title': 'Αρχική', 'home.greeting': 'Hello {{name}}', 'admin.title': 'Διαχείριση' },
    ja: { 'home.title': 'Home', 'home.greeting': 'こんにちは {{name}}', 'admin.title': '管理' },
  },
  overrides: {
    ja: { 'admin.title': '管理' },
  },
}

const none: CatalogFilter = { query: '', namespace: null, locale: null, onlyOverridden: false, onlyUntranslated: false }
const keys = Object.keys(data.english)
const run = (filter: Partial<CatalogFilter>) => keys.filter((key) => keyMatchesFilter(key, { ...none, ...filter }, data))

test('no filter keeps every key', () => {
  assert.deepEqual(run({}), keys)
})

test('search reaches the chosen language, and only it', () => {
  assert.deepEqual(run({ query: 'αρχ', locale: 'el' }), ['home.title'])
  // Without a language chosen the Greek text is not searched.
  assert.deepEqual(run({ query: 'αρχ' }), [])
  // Keys and English still match with a language chosen.
  assert.deepEqual(run({ query: 'admin', locale: 'el' }), ['admin.title'])
  assert.deepEqual(run({ query: 'hello', locale: 'el' }), ['home.greeting'])
})

test('overridden means overridden in the chosen language', () => {
  assert.deepEqual(run({ onlyOverridden: true }), ['admin.title'])
  assert.deepEqual(run({ onlyOverridden: true, locale: 'ja' }), ['admin.title'])
  assert.deepEqual(run({ onlyOverridden: true, locale: 'el' }), [])
})

test('same-as-English lists what a translator still has to do', () => {
  assert.deepEqual(run({ onlyUntranslated: true, locale: 'el' }), ['home.greeting'])
  assert.deepEqual(run({ onlyUntranslated: true, locale: 'ja' }), ['home.title'])
  // Meaningless without a language, so it narrows nothing.
  assert.deepEqual(run({ onlyUntranslated: true }), keys)
})

test('namespace is a whole segment, not a prefix of one', () => {
  assert.deepEqual(run({ namespace: 'home' }), ['home.title', 'home.greeting'])
  assert.deepEqual(run({ namespace: 'hom' }), [])
})

test('an empty or missing value counts as untranslated', () => {
  assert.equal(isUntranslated('Home', undefined), true)
  assert.equal(isUntranslated('Home', '  '), true)
  assert.equal(isUntranslated('Home', 'Home'), true)
  assert.equal(isUntranslated('Home', 'Αρχική'), false)
})

test('inline saves follow the edit dialog', () => {
  const base = { current: 'Home', bundledDefault: 'Home', hasOverride: false }
  assert.deepEqual(decideInlineSave({ ...base, draft: 'Home' }), { kind: 'none' })
  assert.deepEqual(decideInlineSave({ ...base, draft: 'Αρχική' }), { kind: 'save', value: 'Αρχική' })
  // Clearing the box with nothing overridden sends nothing.
  assert.deepEqual(decideInlineSave({ ...base, draft: '' }), { kind: 'none' })

  const overridden = { current: 'Αρχική', bundledDefault: 'Home', hasOverride: true }
  // Typing the default back, or clearing, removes the override.
  assert.deepEqual(decideInlineSave({ ...overridden, draft: 'Home' }), { kind: 'reset' })
  assert.deepEqual(decideInlineSave({ ...overridden, draft: '' }), { kind: 'reset' })
  assert.deepEqual(decideInlineSave({ ...overridden, draft: 'Αρχή' }), { kind: 'save', value: 'Αρχή' })
})
