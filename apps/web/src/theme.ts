import { createTheme, alpha, type Theme, type ThemeOptions } from '@mui/material/styles'

/**
 * Single source of truth for the app's brand colors. `buildThemeOptions()` below is
 * built from this, and any module that can't call `useTheme()` (plain constants files,
 * non-component code) can import `palette`/`gradients`/`extraColors` directly instead of
 * retyping a hex value — so a future recolor only means editing this file.
 *
 * `primary`/`secondary` are admin-configurable (Settings → System → Appearance) and
 * mutated in place by `applyThemeColorOverrides` below, so this object is intentionally
 * NOT `as const`/frozen — every reader (this module's own `buildThemeOptions`, and the
 * handful of files that import `palette`/`gradients` directly) reads live values.
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

/** Neutral tones used alongside the palette above that aren't part of MUI's PaletteOptions shape. */
export const extraColors = {
  subtleBorder: '#3a3a3a',
} as const

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

function buildThemeOptions(): ThemeOptions {
  return {
    palette: {
      mode: 'dark',
      ...palette,
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
            scrollbarColor: `${extraColors.subtleBorder} ${palette.background.paper}`,
            '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
              width: 8,
              height: 8,
            },
            '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
              borderRadius: 8,
              backgroundColor: extraColors.subtleBorder,
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

export function createAppTheme(direction: 'ltr' | 'rtl'): Theme {
  return createTheme({ ...buildThemeOptions(), direction })
}

/** @deprecated Prefer `createAppTheme('ltr')` from RtlProviders; kept for Storybook or tests. */
export const theme = createAppTheme('ltr')
