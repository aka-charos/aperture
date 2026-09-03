import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Button, CircularProgress, Tooltip, Typography, alpha } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import LogoutIcon from '@mui/icons-material/Logout'
import { useAuth } from '@/hooks/useAuth'

/**
 * Fixed height, because the shell subtracts it from the viewport in three
 * places (see IMPERSONATION_BANNER_HEIGHT's use in Layout). A banner that sized
 * itself to its content would make that arithmetic a guess.
 */
export const IMPERSONATION_BANNER_HEIGHT = 44

function minutesLeft(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 60000))
}

/**
 * The way out of an assumed session.
 *
 * It lives inside the app bar, which is the one piece of chrome every
 * authenticated page renders — so "on any page you navigate to" is a structural
 * property here rather than something each page has to remember. The remaining
 * time is shown because the exit is not the only one: the grant lapses by
 * itself, and knowing that is the difference between a mode and a trap.
 */
export function ImpersonationBanner() {
  const { t } = useTranslation()
  const { user, impersonation, stopImpersonation } = useAuth()
  const [leaving, setLeaving] = useState(false)
  const [remaining, setRemaining] = useState(() =>
    impersonation ? minutesLeft(impersonation.expiresAt) : 0
  )

  useEffect(() => {
    if (!impersonation) return
    setRemaining(minutesLeft(impersonation.expiresAt))
    const timer = window.setInterval(
      () => setRemaining(minutesLeft(impersonation.expiresAt)),
      30_000
    )
    return () => window.clearInterval(timer)
  }, [impersonation])

  if (!impersonation || !user) return null

  const viewing = user.displayName || user.username
  const admin = impersonation.admin.displayName || impersonation.admin.username

  const handleExit = () => {
    // Never cleared on the way out: the call ends in a page load either way, so
    // leaving it spinning is honest about what is happening.
    setLeaving(true)
    void stopImpersonation()
  }

  return (
    <Box
      role="status"
      sx={(theme) => ({
        height: IMPERSONATION_BANNER_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: { xs: 1.5, sm: 2 },
        // Reads as a mode the whole app is in, not as a notification to
        // dismiss. Warning rather than error: nothing is wrong, but nothing
        // here is the admin's own account either.
        backgroundColor: theme.palette.warning.main,
        color: theme.palette.warning.contrastText,
        borderBottom: `1px solid ${alpha(theme.palette.common.black, 0.15)}`,
      })}
    >
      <VisibilityIcon fontSize="small" sx={{ flexShrink: 0 }} />

      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {t('impersonation.bannerViewingAs', { name: viewing })}
      </Typography>

      {/* The qualifiers, dropped first when there is no room for them. The
          sentence above still says everything an admin needs to act on. */}
      <Typography
        variant="body2"
        sx={{
          display: { xs: 'none', md: 'block' },
          opacity: 0.9,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {t('impersonation.bannerReadOnly')}
      </Typography>

      <Box sx={{ flexGrow: 1 }} />

      <Tooltip title={t('impersonation.bannerAutoEndTooltip', { count: remaining })}>
        <Typography
          variant="caption"
          sx={{ display: { xs: 'none', sm: 'block' }, opacity: 0.9, whiteSpace: 'nowrap' }}
        >
          {t('impersonation.bannerAutoEnd', { count: remaining })}
        </Typography>
      </Tooltip>

      <Button
        size="small"
        variant="contained"
        color="inherit"
        onClick={handleExit}
        disabled={leaving}
        startIcon={
          leaving ? <CircularProgress size={14} color="inherit" /> : <LogoutIcon fontSize="small" />
        }
        sx={(theme) => ({
          flexShrink: 0,
          whiteSpace: 'nowrap',
          textTransform: 'none',
          fontWeight: 600,
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
          '&:hover': { backgroundColor: theme.palette.background.paper, opacity: 0.9 },
        })}
      >
        {t('impersonation.bannerExit', { name: admin })}
      </Button>
    </Box>
  )
}
