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
const {
  applyThemeColorOverrides,
  BUTTON_FONT,
  buttonFontFor,
  createAppTheme,
  createGraphiteTheme,
  decorativeButtonColor,
  decorativeColor,
  documentChromeColor,
  MONO_FONT,
} = require('./theme') as typeof import('./theme')

const MODES: ColorMode[] = ['light', 'dark']

test("an sx fontFamily of 'monospace' resolves to IBM Plex Mono in both modes", () => {
  for (const mode of MODES) {
    const theme = createAppTheme('ltr', mode)
    const css = theme.unstable_sx({ fontFamily: 'monospace' }) as { fontFamily?: string }
    assert.equal(css.fontFamily, MONO_FONT, mode)
  }
})

test('a letter Plex Mono does not draw falls back to Inter, never to a system monospace', () => {
  // Plex Mono has no Greek: behind the code stack a Greek button label came out
  // in the phone's typewriter face. Inter must be the very next face.
  const faces = BUTTON_FONT.split(',').map((face) => face.trim())
  assert.deepEqual(faces.slice(0, 2), ['"IBM Plex Mono"', '"Inter"'])
  assert.ok(!faces.includes('monospace'), 'no generic monospace in the button stack')
})

test('a language Plex Mono cannot draw gets its buttons in Inter outright, and an unknown one too', () => {
  // Behind Plex Mono a Greek label mixed two faces: Latin words and digits
  // monospace, Greek letters in Inter.
  for (const language of ['el', 'ar', 'hi', 'ja', 'ko', 'zh', 'he', 'xx']) {
    assert.ok(!buttonFontFor(language).includes('Plex'), language)
    assert.ok(!createAppTheme('ltr', 'dark', language).typography.button.fontFamily?.includes('Plex'), language)
  }
  for (const language of ['en', 'en-GB', 'de', 'ru']) assert.equal(buttonFontFor(language), BUTTON_FONT, language)
})

test('button labels are monospace and tabs stay in the reading face', () => {
  for (const theme of [createAppTheme('ltr', 'dark'), createGraphiteTheme('ltr')]) {
    const name = theme.aperture.name
    assert.equal(theme.typography.button.fontFamily, BUTTON_FONT, name)
    const tab = theme.components?.MuiTab?.styleOverrides?.root as { fontFamily?: string } | undefined
    assert.ok(tab?.fontFamily && !tab.fontFamily.includes('Plex'), `${name}: tabs must not inherit the button face`)
  }
})

test("the browser chrome is told each mode's own page colour", () => {
  assert.equal(documentChromeColor('dark'), createAppTheme('ltr', 'dark').palette.background.default)
  assert.equal(documentChromeColor('light'), createAppTheme('ltr', 'light').palette.background.paper)
})

/**
 * Graphite's two promises (the former light mode, kept off screen), read off the built theme rather than the
 * scheme object, so an override that bypasses the scheme is caught too.
 *
 * Nothing is lighter than the page: the operator's rule, after paper-white
 * sheets and then a run of pale palettes were rejected. So the canvas itself is
 * the ceiling, and any surface drawn lighter than it fails here.
 *
 * Every colour that carries text reaches 4.5:1 (WCAG AA for normal text) on
 * every surface it sits on, and every label reaches it on its own fill. The
 * first Vintage palette's own terracotta and rust read at about 3:1 on its
 * beige, which is how a version shipped unreadable button labels and tab names.
 */
const { getLuminance, getContrastRatio } = require('@mui/material/styles') as typeof import('@mui/material/styles')
const AA_TEXT = 4.5

test('no Graphite surface is lighter than the page', () => {
  const t = createGraphiteTheme('ltr')
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
    assert.ok(getLuminance(colour) <= getLuminance(t.palette.background.default), `${name} ${colour} is lighter than the page`)
  }
})

test('every Graphite text colour reaches 4.5:1 on every surface', () => {
  const t = createGraphiteTheme('ltr')
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
  for (const key of ['primary', 'secondary', 'error', 'warning', 'success', 'info'] as const) {
    const ratio = getContrastRatio(p[key].contrastText, p[key].main)
    assert.ok(ratio >= AA_TEXT, `${key} label on its fill is ${ratio.toFixed(2)}:1`)
  }
})

test('the secondary, information and error colours are told apart', () => {
  const p = createGraphiteTheme('ltr').palette
  const distinct = new Set([p.primary.main, p.secondary.main, p.info.main, p.error.main, p.text.secondary])
  assert.equal(distinct.size, 5)
})

/**
 * Studio, the optional theme. Its pale dark-mode accents are why fills carry a
 * label token at all: `primary.main` there is #87a5ff, on which the white every
 * call site used to write reads at about 2:1.
 */
const JSON_OF = (value: unknown) => JSON.parse(JSON.stringify(value))

test('light is Studio light whichever theme was chosen', () => {
  const studio = JSON_OF(createAppTheme('ltr', 'light', 'en', 'studio'))
  assert.deepEqual(JSON_OF(createAppTheme('ltr', 'light')), studio)
  assert.deepEqual(JSON_OF(createAppTheme('ltr', 'light', 'en', 'classic')), studio)
  assert.equal(createAppTheme('ltr', 'light').aperture.name, 'studio')
  assert.equal(documentChromeColor('light', 'classic'), documentChromeColor('light', 'studio'))
})

test('the chosen theme decides the dark look', () => {
  assert.equal(createAppTheme('ltr', 'dark', 'en', 'classic').palette.background.default, '#0f0f0f')
  assert.equal(createAppTheme('ltr', 'dark', 'en', 'studio').palette.background.default, '#0b101c')
})

test('the former light mode stays buildable and off every screen', () => {
  const graphite = createGraphiteTheme('ltr')
  assert.equal(graphite.aperture.name, 'graphite')
  assert.equal(graphite.palette.mode, 'light')
  assert.notEqual(graphite.palette.background.default, createAppTheme('ltr', 'light').palette.background.default)
})

test('asking for Classic by name changes nothing, and Classic keeps its look', () => {
  assert.deepEqual(JSON_OF(createAppTheme('ltr', 'dark', 'en', 'classic')), JSON_OF(createAppTheme('ltr', 'dark')))
  const classic = createAppTheme('ltr', 'dark')
  assert.equal(classic.aperture.name, 'classic')
  assert.equal(classic.palette.background.default, '#0f0f0f')
  assert.match(classic.typography.fontFamily ?? '', /^"Inter"/)
  // Every call site that wrote white on a fill now reads these.
  assert.equal(classic.palette.surface.onBrand, '#ffffff')
  assert.equal(classic.palette.surface.onStatus, '#ffffff')
})

test('Studio applies in both modes and both directions, on the shared components', () => {
  for (const mode of MODES) {
    for (const direction of ['ltr', 'rtl'] as const) {
      const t = createAppTheme(direction, mode, 'en', 'studio')
      assert.equal(t.aperture.name, 'studio')
      assert.equal(t.direction, direction)
      assert.equal(t.palette.mode, mode)
      assert.match(t.typography.fontFamily ?? '', /^"Manrope"/)
      for (const name of ['MuiCard', 'MuiDialog', 'MuiTableCell', 'MuiOutlinedInput', 'MuiMenu', 'MuiDrawer', 'MuiTooltip', 'MuiLinearProgress'] as const) {
        assert.ok(t.components?.[name]?.styleOverrides, `${mode}: ${name} is themed`)
      }
    }
  }
})

test("Studio's type works in every UI language and keeps code monospace", () => {
  // Plex Mono's language list does not apply: Studio's buttons are in Manrope.
  for (const language of ['en', 'el', 'ja']) {
    assert.ok(!createAppTheme('ltr', 'dark', language, 'studio').typography.button.fontFamily?.includes('Plex'), language)
  }
  const css = createAppTheme('ltr', 'dark', 'en', 'studio').unstable_sx({ fontFamily: 'monospace' }) as { fontFamily?: string }
  assert.equal(css.fontFamily, MONO_FONT)
})

test('every Studio text colour reaches 4.5:1 on every surface, in both modes', () => {
  for (const mode of MODES) {
    const p = createAppTheme('ltr', mode, 'en', 'studio').palette
    const surfaces = [p.background.default, p.background.paper, p.surface.raised]
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
    }
    for (const [name, colour] of Object.entries(texts)) {
      for (const surface of surfaces) {
        const ratio = getContrastRatio(colour, surface)
        assert.ok(ratio >= AA_TEXT, `${mode} ${name} ${colour} on ${surface} is ${ratio.toFixed(2)}:1`)
      }
    }
  }
})

test('every label on a Studio fill reaches 4.5:1, in both modes', () => {
  for (const mode of MODES) {
    const t = createAppTheme('ltr', mode, 'en', 'studio')
    const p = t.palette
    for (const key of ['primary', 'secondary'] as const) {
      const ratio = getContrastRatio(p.surface.onBrand, p[key].main)
      assert.ok(ratio >= AA_TEXT, `${mode}: onBrand on ${key} is ${ratio.toFixed(2)}:1`)
      assert.ok(getContrastRatio(p[key].contrastText, p[key].main) >= AA_TEXT, `${mode}: ${key} contrastText`)
    }
    for (const key of ['success', 'warning', 'error', 'info'] as const) {
      const ratio = getContrastRatio(p.surface.onStatus, p[key].main)
      assert.ok(ratio >= AA_TEXT, `${mode}: onStatus on ${key} is ${ratio.toFixed(2)}:1`)
      assert.ok(getContrastRatio(p[key].contrastText, p[key].main) >= AA_TEXT, `${mode}: ${key} contrastText`)
    }
    const contained = t.components?.MuiButton?.styleOverrides?.containedPrimary as { color: string; backgroundColor: string }
    const ratio = getContrastRatio(contained.color, contained.backgroundColor)
    assert.ok(ratio >= AA_TEXT, `${mode}: a contained button's label is ${ratio.toFixed(2)}:1`)
  }
})

test("a title page's backdrop fades into exactly the sheet it sits on", () => {
  for (const mode of MODES) {
    const { surface } = createAppTheme('ltr', mode, 'en', 'studio').palette
    assert.equal(surface.glassStrong, surface.heroFade, mode)
  }
})

test("Studio's light mode keeps its colours, unlike Graphite's black and white", () => {
  const studio = createAppTheme('ltr', 'light', 'en', 'studio')
  const graphite = createGraphiteTheme('ltr')
  assert.equal(decorativeColor('error')(studio), studio.palette.error.main)
  assert.equal(decorativeColor('error')(graphite), graphite.palette.text.secondary)
  assert.equal(decorativeButtonColor(studio, 'error'), 'error')
  assert.equal(decorativeButtonColor(graphite, 'error'), 'inherit')
})

test('the browser chrome is told the sheet Studio draws the app bar in', () => {
  for (const mode of MODES) {
    assert.equal(documentChromeColor(mode, 'studio'), createAppTheme('ltr', mode, 'en', 'studio').palette.background.paper)
  }
})

test('an admin brand pair replaces Studio accents too, and Reset gives them back', () => {
  try {
    applyThemeColorOverrides({ primary: '#aa3355', secondary: '#335577' })
    for (const mode of MODES) {
      const p = createAppTheme('ltr', mode, 'en', 'studio').palette
      assert.equal(p.primary.main, '#aa3355', mode)
      assert.equal(p.secondary.main, '#335577', mode)
      assert.equal(p.nav.selectedIcon, '#aa3355', mode)
      assert.equal(p.surface.onBrand, p.primary.contrastText, mode)
    }
  } finally {
    applyThemeColorOverrides(null)
  }
  assert.equal(createAppTheme('ltr', 'dark', 'en', 'studio').palette.primary.main, '#87a5ff')
})
