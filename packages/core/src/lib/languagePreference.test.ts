import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_LANGUAGE_FOLLOWS_APP,
  aiLanguageFollowsApp,
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

test('an absent app language means the instance default', () => {
  assert.equal(resolveUiLanguage(undefined, defaults), 'en')
  assert.equal(resolveUiLanguage(null, defaults), 'en')
})

test('an absent recommendations language follows the app', () => {
  // Deliberately NOT the AI default any more: switching the app to Greek from
  // the top bar must move recommendations for someone who never chose.
  assert.equal(resolveAiLanguage(null, 'el', defaults), 'el')
  assert.equal(resolveAiLanguage(undefined, 'el', defaults), 'el')
  assert.equal(aiLanguageFollowsApp(null), true)
  assert.equal(aiLanguageFollowsApp(undefined), true)
  assert.equal(aiLanguageFollowsApp(AI_LANGUAGE_FOLLOWS_APP), true)
  assert.equal(aiLanguageFollowsApp('en'), false)
})

test('an absent choice still cannot pass the admin', () => {
  assert.equal(resolveAiLanguage(null, 'de', defaults), 'en')
})

test('a chosen language stays put when the app language changes', () => {
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
