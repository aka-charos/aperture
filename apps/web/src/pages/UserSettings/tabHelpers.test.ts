import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { USER_SETTINGS_TAB_KEYS, userSettingsTabFromParam, visibleUserSettingsTab } from './tabHelpers.js'

describe('user settings tab params', () => {
  it('resolves every live key to itself', () => {
    for (const key of USER_SETTINGS_TAB_KEYS) {
      assert.equal(userSettingsTabFromParam(key), key)
    }
  })

  it('sends each retired tab to where its settings went', () => {
    // Not the default: an old bookmark has to reach what it could change.
    assert.equal(userSettingsTabFromParam('watcher'), 'recommendations')
    assert.equal(userSettingsTabFromParam('algorithm'), 'recommendations')
    assert.equal(userSettingsTabFromParam('preferences'), 'display')
    // Profile's one editable card was the email address and opt-in.
    assert.equal(userSettingsTabFromParam('profile'), 'account')
  })

  it('no longer treats a retired name as a live key', () => {
    for (const retired of ['watcher', 'algorithm', 'preferences', 'profile']) {
      assert.equal(USER_SETTINGS_TAB_KEYS.includes(retired as never), false, retired)
    }
  })

  it('falls back to the first tab for absent and unknown values', () => {
    assert.equal(userSettingsTabFromParam(null), USER_SETTINGS_TAB_KEYS[0])
    assert.equal(userSettingsTabFromParam(''), USER_SETTINGS_TAB_KEYS[0])
    assert.equal(userSettingsTabFromParam('nonsense'), USER_SETTINGS_TAB_KEYS[0])
    // Inherited object keys are not aliases.
    assert.equal(userSettingsTabFromParam('constructor'), USER_SETTINGS_TAB_KEYS[0])
  })
})

describe('visibleUserSettingsTab', () => {
  it('keeps a tab this viewer has', () => {
    assert.equal(visibleUserSettingsTab('account', ['recommendations', 'display', 'account']), 'account')
  })

  it('lands a tab this viewer lacks on their first tab', () => {
    // A Jellyfin account following a link to the Emby home screen tab.
    assert.equal(visibleUserSettingsTab('home', ['recommendations', 'display', 'account']), 'recommendations')
    // A hidden tab in the MIDDLE no longer shifts the ones after it: keys, not positions.
    assert.equal(visibleUserSettingsTab('home', ['recommendations', 'display', 'home']), 'home')
  })
})
