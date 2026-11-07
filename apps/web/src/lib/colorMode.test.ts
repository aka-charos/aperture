import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// Loaded through require: colorMode.ts reads the theme, and MUI 6 ships its
// styles entry as CommonJS with no export map, so node's ESM loader can neither
// resolve it nor see its named exports, while tsx's CommonJS hook loads both as
// the bundler would.
const require = createRequire(import.meta.url)
const { appearanceFromLegacy, nextAppearance, parseAppearance } = require('./colorMode') as typeof import('./colorMode')

test('a stored appearance is read back only when it is one of the three', () => {
  for (const appearance of ['light', 'black', 'dark'] as const) assert.equal(parseAppearance(appearance), appearance)
  // Anything else is "no choice", so the default applies rather than a guess.
  for (const raw of [null, undefined, '', 'Light', 'system', 'auto', 1, true]) {
    assert.equal(parseAppearance(raw), null)
  }
})

test("what someone chose before there were three keeps looking the same", () => {
  // Nothing saved: the original look.
  assert.equal(appearanceFromLegacy(null, null), 'black')
  // The old dark was today's Black, unless they had picked Studio.
  assert.equal(appearanceFromLegacy('dark', null), 'black')
  assert.equal(appearanceFromLegacy('dark', 'classic'), 'black')
  assert.equal(appearanceFromLegacy('dark', 'studio'), 'dark')
  // Light was Studio's whichever theme was picked.
  assert.equal(appearanceFromLegacy('light', null), 'light')
  assert.equal(appearanceFromLegacy('light', 'studio'), 'light')
  // "Follow device" is gone: the dark look they had.
  assert.equal(appearanceFromLegacy('system', 'classic'), 'black')
  assert.equal(appearanceFromLegacy('system', 'studio'), 'dark')
})

test('the app bar button visits all three and comes back', () => {
  assert.equal(nextAppearance('light'), 'black')
  assert.equal(nextAppearance('black'), 'dark')
  assert.equal(nextAppearance('dark'), 'light')
})
