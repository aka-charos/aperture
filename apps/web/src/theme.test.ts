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

/**
 * The light mode's two promises, read off the built theme rather than the
 * scheme object, so an override that bypasses the scheme is caught too.
 *
 * No surface is white: the operator's rule after paper-white sheets were tried
 * and rejected. The ceiling sits just above the lightest base step (#efe9dd,
 * luminance 0.818), so any background drifting toward white fails here.
 *
 * Every colour that carries text reaches 4.5:1 (WCAG AA for normal text) on
 * every surface it sits on, and every label reaches it on its own fill. The
 * palette's own terracotta and rust read at about 3:1 on the beige, which is
 * how a first version shipped unreadable button labels and tab names.
 */
const { getLuminance, getContrastRatio } = require('@mui/material/styles') as typeof import('@mui/material/styles')
const LIGHT_SURFACE_CEILING = 0.83
const AA_TEXT = 4.5

test('no light-mode surface is white', () => {
  const t = createAppTheme('ltr', 'light')
  const surfaces: Record<string, string> = {
    'background.default': t.palette.background.default,
    'background.paper': t.palette.background.paper,
    'surface.raised': t.palette.surface.raised,
    'surface.raisedHover': t.palette.surface.raisedHover,
    'surface.glass': t.palette.surface.glass,
    'surface.glassStrong': t.palette.surface.glassStrong,
    'surface.panel': t.palette.surface.panel,
    'surface.heroFade': t.palette.surface.heroFade,
    'surface.fill': t.palette.surface.fill,
    'surface.fillDeep': t.palette.surface.fillDeep,
    'surface.logoPlate': t.palette.surface.logoPlate,
    'nav.selectedBg': t.palette.nav.selectedBg,
  }
  for (const [name, colour] of Object.entries(surfaces)) {
    assert.ok(getLuminance(colour) <= LIGHT_SURFACE_CEILING, `${name} ${colour} is too close to white`)
  }
})

test('every light-mode text colour reaches 4.5:1 on every surface', () => {
  const t = createAppTheme('ltr', 'light')
  const p = t.palette
  const surfaces = [p.background.default, p.background.paper, p.surface.raised, p.nav.selectedBg]
  const texts: Record<string, string> = {
    'text.primary': p.text.primary,
    'text.secondary': p.text.secondary,
    'primary.main': p.primary.main,
    'secondary.main': p.secondary.main,
    'error.main': p.error.main,
    'warning.main': p.warning.main,
    'success.main': p.success.main,
    'info.main': p.info.main,
    'mediaType.movie': p.mediaType.movie,
    'mediaType.series': p.mediaType.series,
    'nav.selectedText': p.nav.selectedText,
  }
  for (const [name, colour] of Object.entries(texts)) {
    for (const surface of surfaces) {
      const ratio = getContrastRatio(colour, surface)
      assert.ok(ratio >= AA_TEXT, `${name} ${colour} on ${surface} is ${ratio.toFixed(2)}:1`)
    }
  }
  for (const key of ['primary', 'secondary'] as const) {
    const ratio = getContrastRatio(p[key].contrastText, p[key].main)
    assert.ok(ratio >= AA_TEXT, `${key} label on its fill is ${ratio.toFixed(2)}:1`)
  }
})

test('the secondary, information and error colours are told apart', () => {
  const p = createAppTheme('ltr', 'light').palette
  const distinct = new Set([p.primary.main, p.secondary.main, p.info.main, p.error.main, p.text.secondary])
  assert.equal(distinct.size, 5)
})
