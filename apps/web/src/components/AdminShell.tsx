import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Box,
  CircularProgress,
  Drawer,
  GlobalStyles,
  IconButton,
  Link,
  Paper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import { AdminErrorBoundary } from './AdminErrorBoundary'
import { AdminNavColumn } from './AdminNavColumn'
import { ApiErrorAlert } from './ApiErrorAlert'
import { useAdminSearch } from '@/hooks/useAdminSearch'
import { usePageHeader } from '@/hooks/usePageHeader'
import {
  ADMIN_GROUPS,
  adminEntryForPath,
  adminEntryPath,
  adminEntriesInGroup,
} from '@/pages/admin/nav/registry'

const NAV_WIDTH = 250

/** Long enough to notice after the scroll settles, short enough not to nag. */
const FLASH_MS = 1600

/**
 * The admin console's frame: a vertical nav column and one section beside it.
 *
 * This replaces a horizontal tab strip that sat above two more horizontal tab
 * strips. Tabs are a flat control, and the console is a tree — with 41
 * destinations, two of the three strips had to scroll sideways, so the
 * navigation could not show what it contained. Here every destination is a
 * route, which is also what gives the palette something to link to.
 */
export function AdminShell() {
  const { t } = useTranslation()
  const theme = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const { open: openSearch } = useAdminSearch()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))
  const [drawerOpen, setDrawerOpen] = useState(false)

  const entry = adminEntryForPath(location.pathname)
  const group = ADMIN_GROUPS.find((g) => g.id === entry?.group)

  /**
   * A route below a leaf — `/admin/access/users/42` — is a record, not a
   * section. The shell knows which section it is under; only the page knows what
   * the record is called, so the page owns the trail there and the shell stays
   * quiet rather than stacking a second one above it.
   */
  const isDetailRoute = entry
    ? // React Router matches `/admin/integrations/omdb/` to the same route, so
      // a trailing slash — typed, or added by a proxy — must not read as a
      // record page and silently drop the breadcrumb and the title.
      location.pathname.replace(/\/+$/, '') !== adminEntryPath(entry)
    : false


  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  /**
   * A field result lands on `route#anchor`. The section is lazy, so the element
   * does not exist when the hash arrives — hence the retry rather than a single
   * lookup on mount.
   */
  useEffect(() => {
    const anchor = location.hash.slice(1)
    if (!anchor) return

    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    let flashTimer: ReturnType<typeof setTimeout>

    const tryScroll = () => {
      const el = document.getElementById(anchor)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.setAttribute('data-admin-flash', 'true')
        flashTimer = setTimeout(() => el.removeAttribute('data-admin-flash'), FLASH_MS)
        return
      }
      if (attempts++ < 20) timer = setTimeout(tryScroll, 100)
    }

    timer = setTimeout(tryScroll, 60)
    return () => {
      clearTimeout(timer)
      clearTimeout(flashTimer)
    }
    // `location.key` is what makes searching for the same field twice work:
    // the second search changes neither the path nor the hash, so keying on
    // those alone left the palette closing onto a page that did nothing.
  }, [location.hash, location.pathname, location.key])

  const handleNavigate = useCallback(() => setDrawerOpen(false), [])

  const nav = <AdminNavColumn onOpenSearch={openSearch} onNavigate={handleNavigate} />

  return (
    <>
      <GlobalStyles
        styles={{
          '@keyframes apertureAdminFlash': {
            '0%, 100%': { boxShadow: 'none' },
            '25%, 75%': { boxShadow: `0 0 0 3px ${theme.palette.primary.main}` },
          },
          '[data-admin-flash]': {
            borderRadius: '6px',
            animation: 'apertureAdminFlash 1.6s ease-in-out',
          },
          '@media (prefers-reduced-motion: reduce)': {
            '[data-admin-flash]': {
              animation: 'none',
              boxShadow: `0 0 0 3px ${theme.palette.primary.main}`,
              borderRadius: '6px',
            },
          },
        }}
      />

      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
        {/* Desktop rail. Sticky rather than fixed so it scrolls with a short
            page and holds still on a long one. */}
        {!isNarrow && (
          <Paper
            elevation={0}
            sx={{
              width: NAV_WIDTH,
              flexShrink: 0,
              position: 'sticky',
              // App bar + 24px. Same reason as the cap below: the bar's height is
              // not a constant while an assumed session is on screen.
              top: 'calc(var(--aperture-chrome-top, 64px) + 24px)',
              /**
               * The rail is as tall as its content, up to the viewport.
               *
               * It was a fixed `height: calc(100vh - 112px)`, which is wrong in
               * both directions at once: measured, a collapsed column of 676px
               * of content sat in a 788px box with 112px of dead space under
               * the footer, and an expanded one of 1461px sat in the same 788px
               * box behind an inner scrollbar. The height simply never moved.
               *
               * A cap works here only because the Paper is a column flex
               * container and the scrolling child is `flex: 1; minHeight: 0` —
               * that pair is what lets the child fill a bounded parent and
               * still shrink. The earlier attempt failed because the child
               * asked for `height: 100%` of a parent with no definite height,
               * which resolves to `auto` and overflows a `maxHeight` silently.
               */
              // 112px was the app bar plus Layout's main padding. The bar half is
              // a variable now because it grows by the impersonation banner.
              maxHeight: 'calc(100vh - var(--aperture-chrome-top, 64px) - 48px)',
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
              overflow: 'hidden',
              display: 'flex',
              // Column, so the nav's own flex:1 means "fill the height" rather
              // than "fill the width" — this Paper is the only ancestor with a
              // bounded height for it to fill.
              flexDirection: 'column',
            }}
          >
            {nav}
          </Paper>
        )}

        <Drawer
          open={isNarrow && drawerOpen}
          onClose={() => setDrawerOpen(false)}
          slotProps={{ paper: { sx: { width: NAV_WIDTH } } }}
        >
          {nav}
        </Drawer>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            {isNarrow && (
              <IconButton
                size="small"
                onClick={() => setDrawerOpen(true)}
                aria-label={t('adminNav.openNav')}
              >
                <MenuIcon fontSize="small" />
              </IconButton>
            )}

            {group && entry && !isDetailRoute && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Link
                  component="button"
                  variant="caption"
                  underline="hover"
                  color="text.secondary"
                  onClick={() => navigate('/admin')}
                >
                  {t('admin.title')}
                </Link>
                <NavigateNextIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                {/* A one-entry group has no heading of its own to name, so the
                    breadcrumb would repeat the leaf twice. */}
                {adminEntriesInGroup(group.id).length > 1 && (
                  <>
                    <Link
                      component="button"
                      variant="caption"
                      underline="hover"
                      color="text.secondary"
                      onClick={() => navigate(adminEntryPath(adminEntriesInGroup(group.id)[0]))}
                    >
                      {t(group.labelKey)}
                    </Link>
                    <NavigateNextIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                  </>
                )}
                <Typography variant="caption" color="text.primary" fontWeight={600} noWrap>
                  {t(entry.titleKey)}
                </Typography>
              </Box>
            )}
          </Box>

          {/* The app bar carries the title at md+; below it there is no room,
              so the page states its own name. Skipped for the five that draw
              their own heading. */}
          {isNarrow && entry && !entry.ownsHeading && !isDetailRoute && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="h5" fontWeight={700}>
                {t(entry.titleKey)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t(entry.blurbKey)}
              </Typography>
            </Box>
          )}

          {/* Exactly one publisher per route. The five destinations that were
              pages before they were leaves announce themselves, so the shell
              stays out of it — and it has to stay out by not mounting, not by
              publishing an empty title: React runs child effects before parent
              ones, so a shell publishing '' would blank the bar the page had
              just filled in. */}
          {entry && !entry.ownsHeading && !isDetailRoute && (
            <AdminHeaderPublisher title={t(entry.titleKey)} blurb={t(entry.blurbKey)} />
          )}

          {/* Integration failures belong where the integrations are configured,
              which is the whole group rather than any one card in it. */}
          {entry?.group === 'integrations' && <ApiErrorAlert maxErrors={5} />}

          <AdminErrorBoundary resetKey={location.pathname}>
            <Suspense
              fallback={
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                  <CircularProgress />
                </Box>
              }
            >
              <Outlet />
            </Suspense>
          </AdminErrorBoundary>
        </Box>
      </Box>
    </>
  )
}

/**
 * Publishes a section's name to the app bar. A component rather than a call in
 * the shell, so "this route publishes nothing" is expressed by not rendering it
 * — see the note at the call site.
 */
function AdminHeaderPublisher({ title, blurb }: { title: string; blurb: string }) {
  usePageHeader(title, blurb)
  return null
}
