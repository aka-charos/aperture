/**
 * The type system both appearances share, read off the built themes.
 *
 * Plex Mono reaches the app's ~35 `fontFamily: 'monospace'` call sites without
 * any of them changing, through a MUI lookup rather than a rule anyone wrote: an
 * sx `fontFamily` value is first looked up as a path on `theme.typography` and
 * then as `fontFamily<Value>`, so `'monospace'` lands on `fontFamilyMonospace`.
 * Nothing in a build or a typecheck would notice if a MUI upgrade changed that
 * fallback, or if `fontFamilyMonospace` were renamed: every one of those sites
 * would quietly go back to the browser's default monospace. This pins it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { ColorMode } from './theme'

// Loaded through require: MUI 6 ships its styles entry as CommonJS with no
// export map, so node's ESM loader can neither resolve it nor see its named
// exports, while tsx's CommonJS hook loads theme.ts and MUI as the bundler would.
const require = createRequire(import.meta.url)
const { createAppTheme, documentChromeColor, MONO_FONT } = require('./theme') as typeof import('./theme')

const MODES: ColorMode[] = ['light', 'dark']

test("an sx fontFamily of 'monospace' resolves to IBM Plex Mono in both modes", () => {
  for (const mode of MODES) {
    const theme = createAppTheme('ltr', mode)
    const css = theme.unstable_sx({ fontFamily: 'monospace' }) as { fontFamily?: string }
    assert.equal(css.fontFamily, MONO_FONT, mode)
  }
})

test('button labels are monospace and tabs stay in the reading face', () => {
  for (const mode of MODES) {
    const theme = createAppTheme('ltr', mode)
    assert.equal(theme.typography.button.fontFamily, MONO_FONT, mode)
    const tab = theme.components?.MuiTab?.styleOverrides?.root as { fontFamily?: string } | undefined
    assert.ok(tab?.fontFamily && !tab.fontFamily.includes('Plex'), `${mode}: tabs must not inherit the button face`)
  }
})

test("the browser chrome is told each mode's own page colour", () => {
  assert.equal(documentChromeColor('dark'), createAppTheme('ltr', 'dark').palette.background.default)
  assert.equal(documentChromeColor('light'), createAppTheme('ltr', 'light').palette.background.paper)
})
