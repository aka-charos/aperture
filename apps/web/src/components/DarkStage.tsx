import { useMemo, type ReactNode } from 'react'
import { ThemeProvider, useTheme } from '@mui/material/styles'
import { createAppTheme } from '@/theme'
import { useThemeColorOverrides } from '@/lib/branding'

/**
 * Renders its children in the dark theme whatever the chosen mode. For a page
 * designed as a dark stage from edge to edge — the sign-in page paints its own
 * night-sky background and white type — where the light mode's ink text would
 * land on that background unreadable.
 */
export function DarkStage({ children }: { children: ReactNode }) {
  const outer = useTheme()
  // The brand colours are mutated in place (theme.ts); subscribing re-renders here.
  const overrides = useThemeColorOverrides()
  const theme = useMemo(
    () => (outer.palette.mode === 'dark' ? outer : createAppTheme(outer.direction, 'dark')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outer, overrides]
  )
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}
