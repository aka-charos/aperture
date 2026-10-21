import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseColorMode } from './colorMode'

test('a stored mode is read back only when it is one of the two', () => {
  assert.equal(parseColorMode('light'), 'light')
  assert.equal(parseColorMode('dark'), 'dark')
  // Anything else is "no choice", so the default applies rather than a guess.
  for (const raw of [null, undefined, '', 'Light', 'system', 'auto', 1, true]) {
    assert.equal(parseColorMode(raw), null)
  }
})
