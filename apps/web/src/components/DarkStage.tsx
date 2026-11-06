import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemeProvider, useTheme } from '@mui/material/styles'
import { useAppTheme } from '@/lib/useAppTheme'
import { FULL_PAGE_DARK_STAGE, holdDarkDocument } from '@/lib/colorMode'

/**
 * Renders its children dark whatever the chosen appearance. For a surface
 * designed as a dark stage — the sign-in page paints its own night-sky background
 * and white type, the similarity graph draws for a dark canvas — where Light's ink
 * text would land on that background unreadable. In Black or Dark nothing changes.
 * Under Light, a panel takes Dark, the same type and accent as the page around it,
 * and a stage that is the whole page takes `FULL_PAGE_DARK_STAGE`.
 *
 * `fullPage` is for a stage that IS the page: the browser is then told the
 * document is dark too (address bar, native controls), which would be wrong
 * for a dark panel sitting inside a light page.
 */
export function DarkStage({ children, fullPage = false }: { children: ReactNode; fullPage?: boolean }) {
  const outer = useTheme()
  const { i18n } = useTranslation()
  const isDark = outer.palette.mode === 'dark'
  const stage = useAppTheme(outer.direction, isDark ? null : fullPage ? FULL_PAGE_DARK_STAGE : 'dark', i18n.language)
  useEffect(() => (fullPage ? holdDarkDocument() : undefined), [fullPage])
  return <ThemeProvider theme={stage ?? outer}>{children}</ThemeProvider>
}
