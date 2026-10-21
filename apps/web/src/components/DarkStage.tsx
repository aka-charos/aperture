import { useEffect, type ReactNode } from 'react'
import { ThemeProvider, useTheme } from '@mui/material/styles'
import { useAppTheme } from '@/lib/useAppTheme'
import { holdDarkDocument } from '@/lib/colorMode'

/**
 * Renders its children in the dark theme whatever the chosen mode. For a
 * surface designed as a dark stage — the sign-in page paints its own night-sky
 * background and white type, the similarity graph draws for a dark canvas —
 * where the light mode's ink text would land on that background unreadable.
 *
 * `fullPage` is for a stage that IS the page: the browser is then told the
 * document is dark too (address bar, native controls), which would be wrong
 * for a dark panel sitting inside a light page.
 */
export function DarkStage({ children, fullPage = false }: { children: ReactNode; fullPage?: boolean }) {
  const outer = useTheme()
  const dark = useAppTheme(outer.direction, 'dark')
  useEffect(() => (fullPage ? holdDarkDocument() : undefined), [fullPage])
  return <ThemeProvider theme={outer.palette.mode === 'dark' ? outer : dark}>{children}</ThemeProvider>
}
