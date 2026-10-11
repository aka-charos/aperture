import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REDACTED_SETTING_VALUE, isSensitiveSettingKey, loggableSettingValue } from './settingLog.js'

test('the integration blobs that leaked are redacted', () => {
  // Each of these carries a password or key inside its JSON, under a name
  // holding none of the trigger words. All four used to print in full.
  for (const key of [
    'smtp_integration',
    'crw_integration',
    'decision_model_integration',
    'translation_integration',
  ]) {
    const value = JSON.stringify({ host: 'mail.example.com', password: 'hunter2', apiKey: 'sk-live' })
    assert.equal(loggableSettingValue(key, value), REDACTED_SETTING_VALUE, key)
  }
})

test('any structured value is redacted, whatever it is called', () => {
  assert.equal(loggableSettingValue('some_future_integration', '{"key":"x"}'), REDACTED_SETTING_VALUE)
  assert.equal(loggableSettingValue('some_list', '  ["a","b"]'), REDACTED_SETTING_VALUE)
})

test('scalar credentials are recognised by name', () => {
  for (const key of [
    'media_server_api_key',
    'tmdb_api_key',
    'seerr_api_key',
    'mdblist_api_key',
    'trakt_client_secret',
    'lldap_admin_password',
    'some_token',
    'ai_provider_credentials',
  ]) {
    assert.ok(isSensitiveSettingKey(key), key)
    assert.equal(loggableSettingValue(key, 'plain-secret'), REDACTED_SETTING_VALUE, key)
  }
})

test('ordinary scalar settings still log their value', () => {
  assert.equal(loggableSettingValue('setup_complete', 'true'), 'true')
  assert.equal(loggableSettingValue('media_server_base_url', 'http://emby:8096'), 'http://emby:8096')
  assert.equal(loggableSettingValue('default_ui_language', 'en'), 'en')
})
