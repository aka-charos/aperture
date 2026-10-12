import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_LANGUAGE_FOLLOWS_APP,
  languagePreferenceRefusal,
  resolveAiLanguage,
  resolveUiLanguage,
  type LanguageDefaults,
} from './languagePreference.js'

const defaults: LanguageDefaults = {
  defaultUiLanguage: 'en',
  defaultAiLanguage: 'en',
  enabledUiLanguages: ['en', 'el', 'de'],
  enabledAiLanguages: ['en', 'el'],
}

test('an absent override means the instance default, on both sides', () => {
  assert.equal(resolveUiLanguage(undefined, defaults), 'en')
  assert.equal(resolveUiLanguage(null, defaults), 'en')
  // The app in Greek does not move AI text for someone who never asked:
  // absent kept meaning "the AI default" when following the app was added.
  assert.equal(resolveAiLanguage(null, 'el', defaults), 'en')
  assert.equal(resolveAiLanguage(undefined, 'el', defaults), 'en')
})

test('the app and AI text can be in different languages', () => {
  const ui = resolveUiLanguage('el', defaults)
  assert.equal(ui, 'el')
  assert.equal(resolveAiLanguage('en', ui, defaults), 'en')
})

test('following the app uses the app language when AI may write in it', () => {
  assert.equal(resolveAiLanguage(AI_LANGUAGE_FOLLOWS_APP, 'el', defaults), 'el')
})

test('following the app falls back to the AI default, never past the admin', () => {
  // German is an app language here but not an AI one.
  assert.equal(resolveAiLanguage(AI_LANGUAGE_FOLLOWS_APP, 'de', defaults), 'en')
})

test('an override the admin has since disabled reads as the default', () => {
  assert.equal(resolveUiLanguage('fr', defaults), 'en')
  assert.equal(resolveAiLanguage('de', 'el', defaults), 'en')
  assert.equal(resolveAiLanguage('nonsense', 'el', defaults), 'en')
})

test('storing: null and following the app are always allowed', () => {
  assert.equal(languagePreferenceRefusal('uiLanguage', null, defaults), null)
  assert.equal(languagePreferenceRefusal('aiLanguage', null, defaults), null)
  assert.equal(languagePreferenceRefusal('aiLanguage', AI_LANGUAGE_FOLLOWS_APP, defaults), null)
})

test('storing: following the app is an AI value only', () => {
  assert.notEqual(languagePreferenceRefusal('uiLanguage', AI_LANGUAGE_FOLLOWS_APP, defaults), null)
})

test('storing: a language the admin has not enabled is refused, per side', () => {
  assert.equal(languagePreferenceRefusal('uiLanguage', 'de', defaults), null)
  assert.notEqual(languagePreferenceRefusal('aiLanguage', 'de', defaults), null)
  assert.notEqual(languagePreferenceRefusal('uiLanguage', 'xx', defaults), null)
  assert.notEqual(languagePreferenceRefusal('uiLanguage', 42, defaults), null)
})
