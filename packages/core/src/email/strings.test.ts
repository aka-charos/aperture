import { test } from 'node:test'
import assert from 'node:assert/strict'

import { APP_LOCALE_OPTIONS } from '../lib/locales.js'
import { EMAIL_STRINGS_EN, EMAIL_STRING_TRANSLATIONS, emailLocale, emailText } from './strings.js'

const placeholders = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()

test('every supported language has an entry, and nothing else does', () => {
  const expected = APP_LOCALE_OPTIONS.map((o) => o.code).filter((code) => code !== 'en').sort()
  assert.deepEqual(Object.keys(EMAIL_STRING_TRANSLATIONS).sort(), expected)
})

test('a translation names only keys the English source has', () => {
  for (const [locale, strings] of Object.entries(EMAIL_STRING_TRANSLATIONS)) {
    for (const key of Object.keys(strings)) {
      assert.ok(key in EMAIL_STRINGS_EN, `${locale} has a stray key: ${key}`)
    }
  }
})

test('a translation keeps exactly the placeholders of the English', () => {
  // A dropped {{server}} silently loses a fact; a misspelt one prints nothing.
  for (const [locale, strings] of Object.entries(EMAIL_STRING_TRANSLATIONS)) {
    for (const [key, value] of Object.entries(strings)) {
      const english = EMAIL_STRINGS_EN[key as keyof typeof EMAIL_STRINGS_EN]
      assert.deepEqual(placeholders(value as string), placeholders(english), `${locale} ${key}`)
    }
  }
})

test('no string carries markup — the renderer escapes, it does not trust', () => {
  for (const strings of [EMAIL_STRINGS_EN, ...Object.values(EMAIL_STRING_TRANSLATIONS)]) {
    for (const value of Object.values(strings)) {
      assert.ok(!/<[a-z/]/i.test(value as string), value as string)
    }
  }
})

test('a language falls back to English key by key, never to an empty string', () => {
  assert.equal(emailText('el', 'action.openApp', { appName: 'Aperture' }), 'Άνοιγμα του Aperture')
  // A key missing from a translation reads in English.
  const original = EMAIL_STRING_TRANSLATIONS.el['action.openApp']
  delete (EMAIL_STRING_TRANSLATIONS.el as Record<string, string>)['action.openApp']
  try {
    assert.equal(emailText('el', 'action.openApp', { appName: 'Aperture' }), 'Open Aperture')
  } finally {
    ;(EMAIL_STRING_TRANSLATIONS.el as Record<string, string>)['action.openApp'] = original as string
  }
})

test('placeholders are filled, and one with no value becomes empty rather than braces', () => {
  assert.equal(emailText('en', 'test.subject', { appName: 'Home cinema' }), 'Home cinema: test email')
  assert.equal(emailText('en', 'test.subject'), ': test email')
})

test('a locale is resolved from whatever the caller holds', () => {
  assert.deepEqual(emailLocale('el'), { code: 'el', rtl: false })
  assert.deepEqual(emailLocale('el-GR'), { code: 'el', rtl: false })
  assert.deepEqual(emailLocale('ar'), { code: 'ar', rtl: true })
  assert.deepEqual(emailLocale('tlh'), { code: 'en', rtl: false })
  assert.deepEqual(emailLocale(null), { code: 'en', rtl: false })
})
