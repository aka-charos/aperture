import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { alpha, Box, Button, IconButton, Paper, Typography, useTheme } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined'
import { hintForLocation, tourForLocation } from '@/pages/guide/routeDocs'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useUserHelp } from '@/hooks/useUserHelp'
import { useTour } from '@/hooks/useTour'
import { isTourId, type TourId } from './tour/tours'
import { IconTile } from './tour/IconTile'

/**
 * The one-line tip shown the first time someone opens a screen, with the way
 * to the screen's tour and its guide pages. Closed for good with ×, or by
 * taking the tour.
 *
 * It waits for the welcome tour to have been answered (`mode: 'none'`), or
 * its offer to an existing account to have been put off with ×: one thing at
 * a time, and the welcome tour is the one that explains what these are. Not shown in an assumed session, where closing it could not be saved.
 */
export function ScreenHint() {
  const { t } = useTranslation()
  const theme = useTheme()
  const location = useLocation()
  const { summary, record, canSave, offerSnoozed } = useOnboarding()
  const { active, startTour } = useTour()
  const { openHelp } = useUserHelp()

  const hint = hintForLocation(location.pathname, location.search)
  const tour = tourForLocation(location.pathname, location.search)

  if (!hint || !summary || !canSave || active) return null
  // After the welcome tour is answered, or once its offer was put off for
  // this sign-in — the offer and a tip never show at once.
  if (summary.mode === 'tour') return null
  if (summary.mode === 'offer' && !offerSnoozed) return null
  if (summary.state.hintsDismissed?.includes(hint)) return null

  const dismiss = () => record({ hintsDismissed: [hint] })
  const showTour = Boolean(tour && isTourId(tour))

  return (
    <Paper
      role="note"
      aria-label={t('onboarding.hint.eyebrow')}
      sx={{
        mb: 2.5,
        p: { xs: 1.75, sm: 1.5 },
        ps: { sm: 2 },
        display: 'flex',
        alignItems: { xs: 'flex-start', sm: 'center' },
        flexWrap: { xs: 'wrap', sm: 'nowrap' },
        gap: { xs: 1.5, sm: 2 },
        borderRadius: 3.5,
        backgroundImage: 'none',
        bgcolor: alpha(theme.palette.primary.main, 0.06),
        border: 1,
        borderColor: alpha(theme.palette.primary.main, 0.35),
        position: 'relative',
      }}
    >
      <IconTile>
        <LightbulbOutlinedIcon />
      </IconTile>
      <Box sx={{ flex: '1 1 260px', minWidth: 0, pe: { xs: 4, sm: 0 } }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'primary.light' }}>
          {t('onboarding.hint.eyebrow')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.primary', lineHeight: 1.5 }}>
          {t(`onboarding.hints.${hint}`)}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, ms: { xs: 7, sm: 0 } }}>
        {showTour && (
          <Button
            variant="contained"
            disableElevation
            size="small"
            startIcon={<ExploreOutlinedIcon />}
            onClick={() => {
              dismiss()
              startTour(tour as TourId)
            }}
            sx={{ minHeight: 40, borderRadius: 2.5, px: 1.75, fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            {t('onboarding.tour.showMeAround')}
          </Button>
        )}
        <Button
          variant="outlined"
          color="inherit"
          size="small"
          onClick={() => openHelp(undefined, { offerScreenTour: true })}
          sx={{ minHeight: 40, borderRadius: 2.5, px: 1.5, whiteSpace: 'nowrap', borderColor: alpha(theme.palette.text.primary, 0.14) }}
        >
          {t('onboarding.tour.readMore')}
        </Button>
      </Box>
      <IconButton
        aria-label={t('onboarding.hint.dismiss')}
        onClick={dismiss}
        sx={{
          width: 40,
          height: 40,
          color: 'text.secondary',
          position: { xs: 'absolute', sm: 'static' },
          top: 8,
          insetInlineEnd: 8,
          flex: '0 0 auto',
        }}
      >
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </Paper>
  )
}
