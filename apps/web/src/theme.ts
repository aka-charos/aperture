import { createTheme, alpha, type Theme, type ThemeOptions, type Shadows } from '@mui/material/styles'

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
}

/** The main sidebar's selected entry. */
export interface NavTokens {
  selectedBg: string
  selectedHoverBg: string
  selectedText: string
  selectedIcon: string
}

declare module '@mui/material/styles' {
  interface Palette {
    surface: SurfaceTokens
    nav: NavTokens
  }
  interface PaletteOptions {
    surface?: SurfaceTokens
    nav?: NavTokens
  }
}

/**
 * Single source of truth for the app's brand colors. `buildThemeOptions()` below is
 * built from this, and any module that can't call `useTheme()` (plain constants files,
 * non-component code) can import `palette`/`gradients` directly instead of retyping a
 * hex value — so a future recolor only means editing this file.
 *
 * `primary`/`secondary` are admin-configurable (Settings → System → Appearance) and
 * mutated in place by `applyThemeColorOverrides` below, so this object is intentionally
 * NOT `as const`/frozen — every reader (this module's own `buildThemeOptions`, and the
 * handful of files that import `palette`/`gradients` directly) reads live values.
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

/** Brand gradients repeated across cards/badges/avatars/CTAs. Recomputed whenever the palette changes. */
export const gradients = {
  primaryToSecondary: '',
  primary: '',
  secondary: '',
}

function recomputeGradients(): void {
  gradients.primaryToSecondary = `linear-gradient(135deg, ${palette.primary.main} 0%, ${palette.secondary.main} 100%)`
  gradients.primary = `linear-gradient(135deg, ${palette.primary.main} 0%, ${palette.primary.dark} 100%)`
  gradients.secondary = `linear-gradient(135deg, ${palette.secondary.main} 0%, ${palette.secondary.dark} 100%)`
}
recomputeGradients()

/**
 * The light mode. A soft-gray canvas, white working surfaces, a near-black ink
 * with a faint warm tint, thin neutral borders, and colour kept for meaning
 * (status, the brand's own accents) rather than decoration. Depth comes from
 * borders and the canvas-vs-surface contrast, not from shadows.
 *
 * The status colours are darker than the dark mode's, because they are also
 * used as TEXT, and the dark mode's bright green and amber are under 3:1 on white.
 */
const INK = '#221b1f'
const lightPalette = {
  background: {
    default: '#f4f5f6',
    paper: '#ffffff',
  },
  text: {
    primary: INK,
    secondary: '#5f585c',
    disabled: alpha(INK, 0.38),
  },
  divider: '#d9dcdf',
  action: {
    active: alpha(INK, 0.6),
    hover: alpha(INK, 0.045),
    selected: alpha(INK, 0.08),
    focus: alpha(INK, 0.12),
    disabled: alpha(INK, 0.3),
    disabledBackground: alpha(INK, 0.08),
  },
  error: {
    main: '#d23a3a',
    light: '#e06464',
    dark: '#b02a2a',
  },
  warning: {
    main: '#a86708',
    light: '#c98a1f',
    dark: '#8a5306',
  },
  success: {
    main: '#1b7e44',
    light: '#2e9d5a',
    dark: '#156436',
  },
  info: {
    main: '#2563eb',
    light: '#3b82f6',
    dark: '#1d4ed8',
  },
}

const SURFACES: Record<ColorMode, SurfaceTokens> = {
  dark: {
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
  },
  light: {
    raised: '#ffffff',
    raisedHover: '#f9fafb',
    glass: 'rgba(255, 255, 255, 0.86)',
    glassStrong: 'rgba(250, 250, 251, 0.97)',
    panel: 'rgba(255, 255, 255, 0.78)',
    hairline: alpha(INK, 0.1),
    subtleBorder: '#d3d6d9',
    heroFade: lightPalette.background.default,
    heroTextShadow: '0 1px 2px rgba(255, 255, 255, 0.7)',
    fill: '#e3e5e8',
    fillDeep: '#eceef0',
  },
}

function navTokens(mode: ColorMode): NavTokens {
  return mode === 'light'
    ? { selectedBg: INK, selectedHoverBg: '#3a3236', selectedText: '#ffffff', selectedIcon: '#ffffff' }
    : {
        selectedBg: alpha(palette.primary.main, 0.12),
        selectedHoverBg: alpha(palette.primary.main, 0.18),
        selectedText: palette.text.primary,
        selectedIcon: palette.primary.main,
      }
}

/**
 * Barely-there lift for the light mode: a hairline shadow at rest, growing only
 * for things that genuinely float (menus at 8, dialogs at 24). MUI's own light
 * shadows read heavy on a gray canvas that already separates every surface.
 */
function lightShadows(): Shadows {
  const shadows = ['none']
  for (let i = 1; i <= 24; i++) {
    const y = Math.max(1, Math.round(i * 0.6))
    const blur = Math.round(i * 1.8)
    const a = Math.min(0.14, 0.03 + i * 0.0045).toFixed(3)
    shadows.push(`0 1px 2px ${alpha(INK, 0.04)}, 0 ${y}px ${blur}px rgba(34, 27, 31, ${a})`)
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
 * Applies admin-selected brand colors on top of the defaults, mutating `palette`/
 * `gradients` in place. Called once from `lib/branding.ts` on load and again after an
 * admin saves — never from component render (mutating shared state there would run
 * twice under StrictMode and race with concurrent rendering).
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
  recomputeGradients()
}

function buildThemeOptions(mode: ColorMode): ThemeOptions {
  return mode === 'light' ? buildLightOptions() : buildDarkOptions()
}

const TYPOGRAPHY: ThemeOptions['typography'] = {
  fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  h1: { fontWeight: 700, fontSize: '2.5rem' },
  h2: { fontWeight: 700, fontSize: '2rem' },
  h3: { fontWeight: 600, fontSize: '1.75rem' },
  h4: { fontWeight: 600, fontSize: '1.5rem' },
  h5: { fontWeight: 600, fontSize: '1.25rem' },
  h6: { fontWeight: 600, fontSize: '1rem' },
  button: { textTransform: 'none', fontWeight: 500 },
}

/**
 * The light mode's look, after the "calm corporate" reference: crisper 6px
 * corners, every working surface a white sheet with a 1px border on the gray
 * canvas, a solid ink pill for the selected page, gray table headers, and
 * transitions on colour only. Same type scale and spacing as the dark mode, so
 * switching never reflows a page.
 */
function buildLightOptions(): ThemeOptions {
  const border = lightPalette.divider
  const softLift = `0 1px 2px ${alpha(INK, 0.05)}`
  return {
    palette: {
      mode: 'light',
      primary: { ...palette.primary },
      secondary: { ...palette.secondary },
      ...lightPalette,
      surface: SURFACES.light,
      nav: navTokens('light'),
    },
    typography: TYPOGRAPHY,
    shape: { borderRadius: 6 },
    shadows: lightShadows(),
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            scrollbarColor: `#c4c8cc transparent`,
            '&::-webkit-scrollbar, & *::-webkit-scrollbar': { width: 8, height: 8 },
            '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
              borderRadius: 8,
              backgroundColor: '#c4c8cc',
            },
            '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          },
          '@media (prefers-reduced-motion: no-preference)': {
            'a, button': { transition: 'color 150ms ease, background-color 150ms ease, border-color 150ms ease' },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 6 },
          contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
          outlined: ({ ownerState }) =>
            ownerState.color === 'inherit' ? { borderColor: '#b7babe' } : {},
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
            color: INK,
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
              backgroundColor: alpha(INK, 0.07),
              '&:hover': { backgroundColor: alpha(INK, 0.1) },
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottomColor: border },
          head: { backgroundColor: '#eceef0', fontWeight: 600, color: INK },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: { '&.MuiTableRow-hover:hover': { backgroundColor: '#e9ebed' } },
        },
      },
      MuiChip: {
        styleOverrides: { root: { borderRadius: 6 } },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: lightPalette.background.paper,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: '#b7babe' },
            '&:hover:not(.Mui-focused):not(.Mui-disabled) .MuiOutlinedInput-notchedOutline': { borderColor: '#8e888b' },
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { backgroundColor: alpha(INK, 0.94), fontSize: '0.75rem' },
          arrow: { color: alpha(INK, 0.94) },
        },
      },
      MuiBackdrop: {
        styleOverrides: {
          // Leave the invisible backdrops (menus, popovers) alone.
          root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: alpha(INK, 0.4) } },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: border } },
      },
      MuiTab: {
        styleOverrides: { root: { '&.Mui-selected': { fontWeight: 600 } } },
      },
      // The active side of a segmented control is filled, the same ink as the
      // selected page in the sidebar; a faint tint is lost on a white sheet.
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderColor: '#b7babe',
            '&.Mui-selected': {
              backgroundColor: INK,
              color: '#ffffff',
              '&:hover': { backgroundColor: '#3a3236' },
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
      surface: SURFACES.dark,
      nav: navTokens('dark'),
    },
    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      h1: {
        fontWeight: 700,
        fontSize: '2.5rem',
      },
      h2: {
        fontWeight: 700,
        fontSize: '2rem',
      },
      h3: {
        fontWeight: 600,
        fontSize: '1.75rem',
      },
      h4: {
        fontWeight: 600,
        fontSize: '1.5rem',
      },
      h5: {
        fontWeight: 600,
        fontSize: '1.25rem',
      },
      h6: {
        fontWeight: 600,
        fontSize: '1rem',
      },
      button: {
        textTransform: 'none',
        fontWeight: 500,
      },
    },
    shape: {
      borderRadius: 8,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            scrollbarColor: `${SURFACES.dark.subtleBorder} ${palette.background.paper}`,
            '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
              width: 8,
              height: 8,
            },
            '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
              borderRadius: 8,
              backgroundColor: SURFACES.dark.subtleBorder,
            },
            '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': {
              backgroundColor: palette.background.paper,
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
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
 * light text; in the light mode it stays bright and washes into the gray canvas
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
  return theme.palette.mode === 'light'
    ? 'linear-gradient(135deg, #e6e8ea 0%, #d6dade 100%)'
    : 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
}

export function createAppTheme(direction: 'ltr' | 'rtl', mode: ColorMode = 'dark'): Theme {
  return createTheme({ ...buildThemeOptions(mode), direction })
}

/** @deprecated Prefer `createAppTheme('ltr')` from RtlProviders; kept for Storybook or tests. */
export const theme = createAppTheme('ltr')
