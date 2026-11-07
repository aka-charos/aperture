import { useMemo } from 'react'
import type { Theme } from '@mui/material/styles'
import { createAppTheme, type Appearance } from '@/theme'
import { useThemeColorOverrides } from './branding'

/**
 * The app's MUI theme for a direction, an appearance and the UI language (which
 * picks Black's button face). The ONE place it is built, for the app root and for
 * a dark stage inside a light page alike, so a new input to the theme is added once.
 * Given no appearance it builds nothing, for a caller that only sometimes needs one.
 */
export function useAppTheme(direction: 'ltr' | 'rtl', appearance: Appearance, language: string): Theme
export function useAppTheme(direction: 'ltr' | 'rtl', appearance: Appearance | null, language: string): Theme | null
export function useAppTheme(direction: 'ltr' | 'rtl', appearance: Appearance | null, language: string): Theme | null {
  // theme.ts's palette is mutated in place by branding.ts as overrides load, so
  // createAppTheme rereads the same input either way — the lint rule can't see
  // that dependency. Subscribing here is what turns the mutation into a re-render.
  const themeColorOverrides = useThemeColorOverrides()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (appearance ? createAppTheme(direction, appearance, language) : null), [direction, appearance, language, themeColorOverrides])
}
