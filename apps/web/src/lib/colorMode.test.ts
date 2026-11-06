import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// Loaded through require: colorMode.ts reads the theme, and MUI 6 ships its
// styles entry as CommonJS with no export map, so node's ESM loader can neither
// resolve it nor see its named exports, while tsx's CommonJS hook loads both as
// the bundler would.
const require = createRequire(import.meta.url)
const { parseColorModeChoice, parseUiTheme, resolveColorMode } = require('./colorMode') as typeof import('./colorMode')

test('a stored mode is read back only when it is one of the three', () => {
  assert.equal(parseColorModeChoice('light'), 'light')
  assert.equal(parseColorModeChoice('dark'), 'dark')
  assert.equal(parseColorModeChoice('system'), 'system')
  // Anything else is "no choice", so the default applies rather than a guess.
  for (const raw of [null, undefined, '', 'Light', 'auto', 1, true]) {
    assert.equal(parseColorModeChoice(raw), null)
  }
})

test('anything but a stored Studio is Classic, so nobody is opted in by accident', () => {
  assert.equal(parseUiTheme('studio'), 'studio')
  for (const raw of [null, undefined, '', 'Studio', 'future', 'classic', 1]) {
    assert.equal(parseUiTheme(raw), 'classic')
  }
})

test('only "Follow device" asks the device', () => {
  assert.equal(resolveColorMode('system', true), 'dark')
  assert.equal(resolveColorMode('system', false), 'light')
  assert.equal(resolveColorMode('light', true), 'light')
  assert.equal(resolveColorMode('dark', false), 'dark')
})
