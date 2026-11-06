import { useMemo } from 'react'
import type { Theme } from '@mui/material/styles'
import { createAppTheme, type ColorMode } from '@/theme'
import { useThemeColorOverrides } from './branding'
import { useUiTheme } from './colorMode'

/**
 * The app's MUI theme for a direction, a mode and the UI language (which picks
 * the button face), in the theme chosen for this browser. The ONE place it is
 * built, for the app root and for a dark stage inside a light page alike, so a
 * new input to the theme is added once.
 */
export function useAppTheme(direction: 'ltr' | 'rtl', mode: ColorMode, language: string): Theme {
  // theme.ts's palette is mutated in place by branding.ts as overrides load, so
  // createAppTheme rereads the same input either way — the lint rule can't see
  // that dependency. Subscribing here is what turns the mutation into a re-render.
  const themeColorOverrides = useThemeColorOverrides()
  const uiTheme = useUiTheme()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createAppTheme(direction, mode, language, uiTheme), [direction, mode, language, uiTheme, themeColorOverrides])
}
