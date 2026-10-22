import { createTheme, alpha, lighten, darken, type Theme, type ThemeOptions, type Shadows } from '@mui/material/styles'

/** The two appearances. Dark is the original; light is the calm, bordered one. */
export type ColorMode = 'light' | 'dark'

/**
 * Colours that are not part of MUI's palette shape but differ between the two
 * modes. They live ON the theme (`theme.palette.surface`) rather than in a
 * module-level object, because a value read from a module at render time does
 * not re-render when the mode changes, while an sx path (`'surface.glass'`) or
 * a theme callback does.
 */
export interface SurfaceTokens {
  /** A card sitting inside a panel (chat cards, preview tiles). */
  raised: string
  /** That card under the pointer. */
  raisedHover: string
  /** A translucent panel over the page (chat bubbles, docked panels). */
  glass: string
  /** The same, nearly opaque (a dialog's sheet, the chat input bar). */
  glassStrong: string
  /** A see-through sheet the whole chat sits on, blurred behind. */
  panel: string
  /** A 1px line inside a translucent panel. */
  hairline: string
  /** Borders and fills one step stronger than the divider. */
  subtleBorder: string
  /** What a hero backdrop image fades into at its foot. */
  heroFade: string
  /** Shadow under text set over a backdrop image. */
  heroTextShadow: string
  /** A neutral fill: progress-bar tracks, an empty thumbnail. */
  fill: string
  /** A deeper fill behind posters while they load. */
  fillDeep: string
  /** The gradient shown where a hero has no image. */
  placeholder: string
}

/** The main sidebar's selected entry. */
export interface NavTokens {
  selectedBg: string
  selectedHoverBg: string
  selectedText: string
  selectedIcon: string
}

/** The accent that says "film" or "series" on a card, readable as text on that mode's surfaces. */
export interface MediaTypeTokens {
  movie: string
  series: string
}

/** Brand gradients on avatars, badges and CTAs, built from that mode's primary and secondary. */
export interface GradientTokens {
  primaryToSecondary: string
  primary: string
  secondary: string
}

declare module '@mui/material/styles' {
  interface Palette {
    surface: SurfaceTokens
    nav: NavTokens
    mediaType: MediaTypeTokens
    gradient: GradientTokens
  }
  interface PaletteOptions {
    surface?: SurfaceTokens
    nav?: NavTokens
    mediaType?: MediaTypeTokens
    gradient?: GradientTokens
  }
  // The monospace face. An sx `fontFamily: 'monospace'` (or `fontFamily="monospace"`)
  // is looked up on the typography as `monospace` and then `fontFamilyMonospace`,
  // so every existing use resolves to this without being touched.
  interface TypographyVariants {
    fontFamilyMonospace: string
  }
  interface TypographyVariantsOptions {
    fontFamilyMonospace?: string
  }
}

/**
 * IBM Plex Mono: button labels, IDs, keys, code and logs, in both modes. Loaded
 * from Google Fonts in index.html beside Inter.
 */
export const MONO_FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/**
 * Single source of truth for the app's brand colors. `buildThemeOptions()` below is
 * built from this, and any module that can't call `useTheme()` (plain constants files,
 * non-component code) can import `palette` directly instead of retyping a
 * hex value — so a future recolor only means editing this file.
 *
 * `primary`/`secondary` are admin-configurable (Settings → System → Appearance) and
 * mutated in place by `applyThemeColorOverrides` below, so this object is intentionally
 * NOT `as const`/frozen — every reader (this module's own `buildThemeOptions`, and the
 * handful of files that import `palette` directly) reads live values.
 *
 * Everything apart from the two brand colours is the DARK mode's. A direct reader
 * gets dark values whatever the mode, which is right only for surfaces that are a
 * dark stage in both modes (the similarity graph); anything else reads the theme.
 */
const DEFAULT_PRIMARY = {
  main: '#6366f1', // Indigo
  light: '#818cf8',
  dark: '#4f46e5',
  contrastText: '#ffffff',
}
const DEFAULT_SECONDARY = {
  main: '#8b5cf6', // Purple
  light: '#a78bfa',
  dark: '#7c3aed',
  contrastText: '#ffffff',
}

/** Stable references for "what does the default look like" (reset buttons, isDefault checks). */
export const DEFAULT_THEME_COLORS = {
  primary: DEFAULT_PRIMARY.main,
  secondary: DEFAULT_SECONDARY.main,
} as const

export const palette = {
  primary: { ...DEFAULT_PRIMARY },
  secondary: { ...DEFAULT_SECONDARY },
  background: {
    default: '#0f0f0f',
    paper: '#1a1a1a',
  },
  text: {
    primary: '#f5f5f5',
    secondary: '#a3a3a3',
  },
  divider: '#2a2a2a',
  error: {
    main: '#ef4444',
    light: '#f87171',
    dark: '#dc2626',
  },
  warning: {
    main: '#f59e0b',
    light: '#fbbf24',
    dark: '#d97706',
  },
  success: {
    main: '#22c55e',
    light: '#4ade80',
    dark: '#16a34a',
  },
  info: {
    main: '#3b82f6',
    light: '#60a5fa',
    dark: '#2563eb',
  },
}

/**
 * The light mode: warm and restrained. Ink is the primary colour, one accent
 * (the secondary) carries emphasis, status keeps its meaning, and an admin's
 * own brand colour replaces ink and accent when one is set. Depth comes from
 * borders and the canvas-against-sheet contrast rather than from shadows.
 * Every neutral comes from ONE scheme object, so nothing else in the light
 * mode names a colour of its own.
 */
interface LightScheme {
  /** Text, the primary colour and the selected-page pill. */
  ink: string
  /** The pill and filled toggles under the pointer. */
  inkHover: string
  /** Text and icons set ON ink: the selected pill, a filled toggle, a contained button. */
  onInk: string
  /** Secondary text. */
  muted: string
  /** Behind everything. */
  canvas: string
  /** Cards, panels, the sidebar and the app bar. */
  sheet: string
  /** Inputs and cards sitting inside a panel. */
  raised: string
  /** A row or card under the pointer. */
  raisedHover: string
  /** Dividers and card outlines. */
  border: string
  /** Input and outlined-control outlines. */
  borderStrong: string
  /** An input's outline under the pointer. */
  borderHover: string
  tableHead: string
  /** Progress-bar tracks, an empty thumbnail. */
  fill: string
  /** Behind posters while they load. */
  fillDeep: string
  scrollbar: string
  /** The accent: the secondary colour when no brand colour is set. */
  secondary: string
  /** Information, and the series label: the one cool note in a warm scheme. */
  info: string
  /** The two ends of the gradient shown where a hero has no image. */
  placeholder: [string, string]
}

/**
 * Rosewood, after a rosewood-and-sand moodboard: espresso ink on sand and
 * blush, paper-white sheets, a burnt-orange accent and slate teal for
 * information.
 */
const LIGHT_SCHEME: LightScheme = {
  ink: '#2a1c16',
  inkHover: '#45312a',
  onInk: '#ffffff',
  muted: '#6a574d',
  canvas: '#ecdfd3',
  sheet: '#fbf6f1',
  raised: '#ffffff',
  raisedHover: '#f6ede5',
  border: '#e0cfc0',
  borderStrong: '#c6ad98',
  borderHover: '#8f7564',
  tableHead: '#f6ece3',
  fill: '#e4d3c4',
  fillDeep: '#eadcd0',
  scrollbar: '#cbb29d',
  secondary: '#a9541f',
  info: '#4f6164',
  placeholder: ['#e6d2c1', '#d2b59d'],
}

/**
 * The status colours: muted and darker than the dark mode's, because they are
 * also used as TEXT, and the dark mode's bright green and amber are under 3:1
 * on a light surface. Shared by every scheme.
 */
const LIGHT_STATUS = {
  error: { main: '#b8383a', light: '#cf5f61', dark: '#952a2c' },
  warning: { main: '#8a5a12', light: '#a8772e', dark: '#6e470c' },
  success: { main: '#2f6b47', light: '#4c8762', dark: '#225236' },
}

function lightPaletteFor(s: LightScheme) {
  return {
    background: { default: s.canvas, paper: s.sheet },
    text: { primary: s.ink, secondary: s.muted, disabled: alpha(s.ink, 0.4) },
    divider: s.border,
    action: {
      active: alpha(s.ink, 0.62),
      hover: alpha(s.ink, 0.05),
      selected: alpha(s.ink, 0.08),
      focus: alpha(s.ink, 0.12),
      disabled: alpha(s.ink, 0.32),
      disabledBackground: alpha(s.ink, 0.08),
    },
    ...LIGHT_STATUS,
    info: { main: s.info, light: lighten(s.info, 0.25), dark: darken(s.info, 0.25) },
  }
}

/**
 * The light mode's brand colours: the scheme's ink and accent, unless an admin
 * has set a brand pair, which then replaces BOTH.
 *
 * The pair is one decision. Brand colours are saved together and shown together
 * on the settings page, so a lone primary takes the secondary it was saved
 * beside rather than the scheme's accent — mixing them would put two colours on
 * the page that nobody chose as a pair. "Set" means the saved pair differs from
 * the default one: Reset saves the defaults, so the default pair is what "no
 * brand colour" looks like on the wire, and the settings card says the light
 * appearance answers it with its own colours.
 */
function brandPairIsDefault(): boolean {
  return palette.primary.main === DEFAULT_PRIMARY.main && palette.secondary.main === DEFAULT_SECONDARY.main
}

function lightBrand(s: LightScheme) {
  if (!brandPairIsDefault()) return { primary: { ...palette.primary }, secondary: { ...palette.secondary } }
  const ink = { main: s.ink, light: lighten(s.ink, 0.3), dark: darken(s.ink, 0.3), contrastText: s.onInk }
  const accent = {
    main: s.secondary,
    light: lighten(s.secondary, 0.25),
    dark: darken(s.secondary, 0.25),
    contrastText: s.onInk,
  }
  return { primary: ink, secondary: accent }
}

/** The brand gradients for one mode's primary and secondary. */
function gradientTokens(primary: { main: string; dark: string }, secondary: { main: string; dark: string }): GradientTokens {
  return {
    primaryToSecondary: `linear-gradient(135deg, ${primary.main} 0%, ${secondary.main} 100%)`,
    primary: `linear-gradient(135deg, ${primary.main} 0%, ${primary.dark} 100%)`,
    secondary: `linear-gradient(135deg, ${secondary.main} 0%, ${secondary.dark} 100%)`,
  }
}

const DARK_SURFACES: SurfaceTokens = {
  raised: '#212121',
  raisedHover: '#252525',
  glass: 'rgba(26, 26, 26, 0.7)',
  glassStrong: 'rgba(15, 15, 15, 0.95)',
  panel: 'rgba(15, 15, 15, 0.5)',
  hairline: 'rgba(255, 255, 255, 0.1)',
  subtleBorder: '#3a3a3a',
  heroFade: '#121212',
  heroTextShadow: '2px 2px 4px rgba(0, 0, 0, 0.5)',
  fill: '#424242',
  fillDeep: '#212121',
  placeholder: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
}

function lightSurfaces(s: LightScheme): SurfaceTokens {
  return {
    raised: s.raised,
    raisedHover: s.raisedHover,
    glass: alpha(s.sheet, 0.88),
    // The canvas colour exactly: a title page opened in a dialog fades its
    // backdrop into heroFade, and any other tone here leaves a band.
    glassStrong: s.canvas,
    panel: alpha(s.sheet, 0.8),
    hairline: alpha(s.ink, 0.1),
    subtleBorder: s.borderStrong,
    heroFade: s.canvas,
    heroTextShadow: `0 1px 2px ${alpha(s.sheet, 0.7)}`,
    fill: s.fill,
    fillDeep: s.fillDeep,
    placeholder: `linear-gradient(135deg, ${s.placeholder[0]} 0%, ${s.placeholder[1]} 100%)`,
  }
}

/** The light mode's selected page: a solid ink pill. */
function lightNav(s: LightScheme): NavTokens {
  return { selectedBg: s.ink, selectedHoverBg: s.inkHover, selectedText: s.onInk, selectedIcon: s.onInk }
}

/** The dark mode's selected page: a tint of the brand colour. */
function darkNav(): NavTokens {
  return {
    selectedBg: alpha(palette.primary.main, 0.12),
    selectedHoverBg: alpha(palette.primary.main, 0.18),
    selectedText: palette.text.primary,
    selectedIcon: palette.primary.main,
  }
}

/**
 * Barely-there lift for the light mode: a hairline shadow at rest, growing only
 * for things that genuinely float (menus at 8, dialogs at 24). MUI's own light
 * shadows read heavy on a canvas that already separates every surface.
 */
function lightShadows(ink: string): Shadows {
  const shadows = ['none']
  for (let i = 1; i <= 24; i++) {
    const y = Math.max(1, Math.round(i * 0.6))
    const blur = Math.round(i * 1.8)
    const a = Math.min(0.14, 0.03 + i * 0.0045)
    shadows.push(`0 1px 2px ${alpha(ink, 0.04)}, 0 ${y}px ${blur}px ${alpha(ink, a)}`)
  }
  return shadows as Shadows
}

export interface ThemeColorOverrides {
  primary?: string
  secondary?: string
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

// A throwaway theme purely to borrow MUI's shade-derivation logic (documented
// pattern: `theme.palette.augmentColor`) — light/dark/contrastText aren't
// public standalone exports, only methods on an already-created palette.
let augmentSeed: Theme | null = null
function deriveShades(main: string): { main: string; light: string; dark: string; contrastText: string } {
  augmentSeed ??= createTheme({ palette: { mode: 'dark' } })
  return augmentSeed.palette.augmentColor({ color: { main } })
}

/**
 * Applies admin-selected brand colors on top of the defaults, mutating `palette`
 * in place; the gradients are built from it per mode, on the theme. Called once from
 * `lib/branding.ts` on load and again after an admin saves — never from component
 * render (mutating shared state there would run twice under StrictMode and race
 * with concurrent rendering). In the light mode a set colour replaces the ink.
 *
 * Only `main` is admin-supplied; light/dark/contrastText are derived so the picker
 * only ever needs one value per color.
 */
export function applyThemeColorOverrides(overrides: ThemeColorOverrides | null | undefined): void {
  const primaryMain =
    overrides?.primary && HEX_COLOR_RE.test(overrides.primary)
      ? overrides.primary.toLowerCase()
      : DEFAULT_PRIMARY.main
  const secondaryMain =
    overrides?.secondary && HEX_COLOR_RE.test(overrides.secondary)
      ? overrides.secondary.toLowerCase()
      : DEFAULT_SECONDARY.main

  Object.assign(palette.primary, primaryMain === DEFAULT_PRIMARY.main ? DEFAULT_PRIMARY : deriveShades(primaryMain))
  Object.assign(
    palette.secondary,
    secondaryMain === DEFAULT_SECONDARY.main ? DEFAULT_SECONDARY : deriveShades(secondaryMain)
  )
}

function buildThemeOptions(mode: ColorMode): ThemeOptions {
  return mode === 'light' ? buildLightOptions(LIGHT_SCHEME) : buildDarkOptions()
}

const SANS_FONT = '"Inter", "Roboto", "Helvetica", "Arial", sans-serif'

/**
 * One type system for both modes, so switching never reflows a page: Inter for
 * reading, IBM Plex Mono for button labels, IDs and code. The button size is a
 * step down from MUI's 14px because a monospace label sets wider than Inter at
 * the same size.
 */
const TYPOGRAPHY: ThemeOptions['typography'] = {
  fontFamily: SANS_FONT,
  fontFamilyMonospace: MONO_FONT,
  h1: { fontWeight: 700, fontSize: '2.5rem' },
  h2: { fontWeight: 700, fontSize: '2rem' },
  h3: { fontWeight: 600, fontSize: '1.75rem' },
  h4: { fontWeight: 600, fontSize: '1.5rem' },
  h5: { fontWeight: 600, fontSize: '1.25rem' },
  h6: { fontWeight: 600, fontSize: '1rem' },
  button: { fontFamily: MONO_FONT, textTransform: 'none', fontWeight: 500, fontSize: '0.8125rem', letterSpacing: 0 },
}

/** Code-shaped markup in the monospace face, in both modes. */
const MONO_ELEMENTS = { 'code, kbd, pre, samp': { fontFamily: MONO_FONT } }

/** Small and large buttons, a step down for the same reason as the medium size. */
const BUTTON_SIZES = { sizeSmall: { fontSize: '0.75rem' }, sizeLarge: { fontSize: '0.875rem' } }

/**
 * Tabs read their type from the button variant, so without this every tab bar
 * would turn monospace. They are navigation, which stays in Inter at its old size.
 */
const TAB_TYPE = { fontFamily: SANS_FONT, fontSize: '0.875rem', letterSpacing: '0.02857em' }

/**
 * The light mode's look: crisper 6px corners, every working surface a paper
 * sheet with a 1px border on the sand canvas, ink as the primary colour, a
 * solid ink pill for the selected page, tinted table headers, and transitions
 * on colour only. Every colour here comes from the scheme (`lightColourCallSites`
 * in themeColorCallSites.test.ts holds it to that).
 */
function buildLightOptions(s: LightScheme): ThemeOptions {
  const border = s.border
  const softLift = `0 1px 2px ${alpha(s.ink, 0.06)}`
  const brand = lightBrand(s)
  const lightPalette = lightPaletteFor(s)
  return {
    palette: {
      mode: 'light',
      ...brand,
      ...lightPalette,
      surface: lightSurfaces(s),
      nav: lightNav(s),
      // TEXT on a light surface, so darker than the dark mode's pair; the
      // scheme's info colour for series, the one cool note on a warm page.
      mediaType: { movie: brand.primary.main, series: lightPalette.info.main },
      gradient: gradientTokens(brand.primary, brand.secondary),
    },
    typography: TYPOGRAPHY,
    shape: { borderRadius: 6 },
    shadows: lightShadows(s.ink),
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            scrollbarColor: `${s.scrollbar} transparent`,
            '&::-webkit-scrollbar, & *::-webkit-scrollbar': { width: 8, height: 8 },
            '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
              borderRadius: 8,
              backgroundColor: s.scrollbar,
            },
            '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          },
          ...MONO_ELEMENTS,
          '@media (prefers-reduced-motion: no-preference)': {
            'a, button': { transition: 'color 150ms ease, background-color 150ms ease, border-color 150ms ease' },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 6 },
          ...BUTTON_SIZES,
          contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
          outlined: ({ ownerState }) =>
            ownerState.color === 'inherit' ? { borderColor: s.borderStrong } : {},
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            borderRadius: 10,
            border: `1px solid ${border}`,
            boxShadow: softLift,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
          // A resting panel is a bordered sheet; only floating surfaces cast a
          // shadow worth the name.
          elevation1: { border: `1px solid ${border}`, boxShadow: softLift },
          elevation2: { border: `1px solid ${border}` },
          elevation3: { border: `1px solid ${border}` },
        },
      },
      MuiMenu: {
        styleOverrides: { paper: { border: `1px solid ${border}` } },
      },
      MuiPopover: {
        styleOverrides: { paper: { border: `1px solid ${border}` } },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: lightPalette.background.paper,
            borderInlineEnd: `1px solid ${border}`,
          },
        },
      },
      MuiAppBar: {
        defaultProps: { color: 'inherit', elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: lightPalette.background.paper,
            backgroundImage: 'none',
            color: s.ink,
            boxShadow: 'none',
            border: 0,
            borderBottom: `1px solid ${border}`,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            marginInline: 8,
            '&.Mui-selected': {
              backgroundColor: alpha(s.ink, 0.07),
              '&:hover': { backgroundColor: alpha(s.ink, 0.1) },
              '&.Mui-focusVisible': { backgroundColor: alpha(s.ink, 0.12) },
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottomColor: border },
          head: { backgroundColor: s.tableHead, fontWeight: 600, color: s.ink },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: { '&.MuiTableRow-hover:hover': { backgroundColor: s.raisedHover } },
        },
      },
      MuiChip: {
        styleOverrides: { root: { borderRadius: 6 } },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: s.raised,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: s.borderStrong },
            '&:hover:not(.Mui-focused):not(.Mui-disabled) .MuiOutlinedInput-notchedOutline': { borderColor: s.borderHover },
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { backgroundColor: alpha(s.ink, 0.94), fontSize: '0.75rem' },
          arrow: { color: alpha(s.ink, 0.94) },
        },
      },
      MuiBackdrop: {
        styleOverrides: {
          // Leave the invisible backdrops (menus, popovers) alone.
          root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: alpha(s.ink, 0.4) } },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: border } },
      },
      MuiTab: {
        styleOverrides: { root: { ...TAB_TYPE, '&.Mui-selected': { fontWeight: 600 } } },
      },
      // The active side of a segmented control is filled, the same ink as the
      // selected page in the sidebar; a faint tint is lost on a light sheet.
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderColor: s.borderStrong,
            '&.Mui-selected': {
              backgroundColor: s.ink,
              color: s.onInk,
              '&:hover': { backgroundColor: s.inkHover },
            },
          },
        },
      },
    },
  }
}

function buildDarkOptions(): ThemeOptions {
  return {
    palette: {
      mode: 'dark',
      ...palette,
      surface: DARK_SURFACES,
      nav: darkNav(),
      mediaType: { movie: palette.primary.light, series: '#10b981' },
      gradient: gradientTokens(palette.primary, palette.secondary),
    },
    typography: TYPOGRAPHY,
    shape: {
      borderRadius: 8,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            scrollbarColor: `${DARK_SURFACES.subtleBorder} ${palette.background.paper}`,
            '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
              width: 8,
              height: 8,
            },
            '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
              borderRadius: 8,
              backgroundColor: DARK_SURFACES.subtleBorder,
            },
            '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': {
              backgroundColor: palette.background.paper,
            },
          },
          ...MONO_ELEMENTS,
        },
      },
      MuiTab: {
        styleOverrides: { root: TAB_TYPE },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
          ...BUTTON_SIZES,
          contained: {
            boxShadow: 'none',
            '&:hover': {
              boxShadow: 'none',
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            borderRadius: 12,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: palette.background.paper,
            borderInlineEnd: `1px solid ${palette.divider}`,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: palette.background.paper,
            backgroundImage: 'none',
            borderBottom: `1px solid ${palette.divider}`,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            marginInline: 8,
            '&.Mui-selected': {
              backgroundColor: alpha(palette.primary.main, 0.12),
              '&:hover': {
                backgroundColor: alpha(palette.primary.main, 0.18),
              },
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottomColor: palette.divider,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 6,
          },
        },
      },
    },
  }
}

/**
 * Hero backdrops (a title's page, a person's, a studio's) sit under the page's
 * own text. In the dark mode the image is dimmed and fades into near-black under
 * light text; in the light mode it stays bright and washes into the sand canvas
 * well before the title, because ink on a dark image is unreadable.
 */
export function backdropImageFilter(theme: Theme): string {
  return theme.palette.mode === 'light' ? 'brightness(0.95) saturate(0.9)' : 'brightness(0.6)'
}

/** The fade at the foot of a title page's backdrop. */
export function backdropFootFade(theme: Theme): { height: string; background: string } {
  const fade = theme.palette.surface.heroFade
  return theme.palette.mode === 'light'
    ? {
        height: '85%',
        background: `linear-gradient(to top, ${fade} 0%, ${fade} 30%, ${alpha(fade, 0.8)} 55%, ${alpha(fade, 0)} 100%)`,
      }
    : { height: '60%', background: `linear-gradient(to top, ${fade} 0%, ${alpha(fade, 0)} 100%)` }
}

/** The wash over a person's or studio's rotating backdrop, top to bottom. */
export function backdropFullFade(theme: Theme): string {
  const fade = theme.palette.surface.heroFade
  return theme.palette.mode === 'light'
    ? `linear-gradient(to bottom, ${alpha(fade, 0.2)} 0%, ${alpha(fade, 0.75)} 60%, ${fade} 100%)`
    : `linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.6) 70%, ${fade} 100%)`
}

/** Shown where a hero has no image at all. */
export function backdropPlaceholder(theme: Theme): string {
  return theme.palette.surface.placeholder
}

/** The soft glow in the middle of a full-page stage (the setup wizard). */
export function stageGlow(theme: Theme): string {
  const centre = theme.palette.mode === 'light' ? alpha(theme.palette.primary.main, 0.08) : '#1a1a2e'
  return `radial-gradient(circle at 50% 50%, ${centre} 0%, ${theme.palette.background.default} 100%)`
}

/**
 * The colour the browser's own chrome is told for each mode (the phone address
 * bar, through `<meta name="theme-color">`): the light mode's sheet, which the
 * app bar is drawn in, and the dark mode's page background. Read from the theme's
 * own values so a palette change cannot leave the address bar behind.
 */
export function documentChromeColor(mode: ColorMode): string {
  return mode === 'light' ? LIGHT_SCHEME.sheet : palette.background.default
}

export function createAppTheme(direction: 'ltr' | 'rtl', mode: ColorMode = 'dark'): Theme {
  return createTheme({ ...buildThemeOptions(mode), direction })
}

/** @deprecated Prefer `createAppTheme('ltr')` from RtlProviders; kept for Storybook or tests. */
export const theme = createAppTheme('ltr')
