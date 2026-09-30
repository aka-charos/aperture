import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONDITIONAL_TAB_KEYS,
  USER_SETTINGS_TAB_KEYS,
  userSettingsTabIndexFromParam,
  userSettingsTabParamFromIndex,
} from './tabHelpers.js'

describe('user settings tab params', () => {
  it('round-trips every key', () => {
    // The index is a position in a JSX list, so a key that does not round-trip
    // sends ?tab=algorithm to a different panel than the Algorithm tab.
    USER_SETTINGS_TAB_KEYS.forEach((key, index) => {
      assert.equal(userSettingsTabIndexFromParam(key), index, `${key} -> index`)
      assert.equal(userSettingsTabParamFromIndex(index), key, `index ${index} -> key`)
    })
  })

  it('sends the retired profile tab to Preferences', () => {
    // Not the default. Preferences is where the email address and notification
    // opt-in went when the Profile tab was deleted, so that is the only landing
    // spot where an old link still reaches what it was asking for.
    assert.equal(
      userSettingsTabIndexFromParam('profile'),
      USER_SETTINGS_TAB_KEYS.indexOf('preferences')
    )
  })

  it('no longer treats profile as a live key', () => {
    assert.equal(USER_SETTINGS_TAB_KEYS.includes('profile' as never), false)
  })

  it('falls back to the first tab for absent and unknown values', () => {
    assert.equal(userSettingsTabIndexFromParam(null), 0)
    assert.equal(userSettingsTabIndexFromParam(''), 0)
    assert.equal(userSettingsTabIndexFromParam('nonsense'), 0)
  })

  it('puts every conditional tab after every tab everyone sees', () => {
    // Hiding a tab shifts every later index, so only the tail may be hidden.
    const firstConditional = USER_SETTINGS_TAB_KEYS.findIndex((key) => CONDITIONAL_TAB_KEYS.has(key))
    USER_SETTINGS_TAB_KEYS.forEach((key, index) => {
      if (index > firstConditional && firstConditional >= 0) {
        assert.ok(CONDITIONAL_TAB_KEYS.has(key), `${key} sits after a conditional tab`)
      }
    })
  })

  it('falls back to the first key for an out-of-range index', () => {
    // Reachable if a tab is removed while a stale index sits in component
    // state; undefined here would put `tab=undefined` in the address bar.
    assert.equal(userSettingsTabParamFromIndex(99), USER_SETTINGS_TAB_KEYS[0])
    assert.equal(userSettingsTabParamFromIndex(-1), USER_SETTINGS_TAB_KEYS[0])
  })
})
