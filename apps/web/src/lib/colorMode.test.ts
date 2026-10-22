import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// Loaded through require: colorMode.ts reads the theme, and MUI 6 ships its
// styles entry as CommonJS with no export map, so node's ESM loader can neither
// resolve it nor see its named exports, while tsx's CommonJS hook loads both as
// the bundler would.
const require = createRequire(import.meta.url)
const { parseColorMode } = require('./colorMode') as typeof import('./colorMode')

test('a stored mode is read back only when it is one of the two', () => {
  assert.equal(parseColorMode('light'), 'light')
  assert.equal(parseColorMode('dark'), 'dark')
  // Anything else is "no choice", so the default applies rather than a guess.
  for (const raw of [null, undefined, '', 'Light', 'system', 'auto', 1, true]) {
    assert.equal(parseColorMode(raw), null)
  }
})
