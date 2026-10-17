import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Box, Button, IconButton, Paper, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import { hintForLocation, tourForLocation } from '@/pages/guide/routeDocs'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useUserHelp } from '@/hooks/useUserHelp'
import { useTour } from './tour/useTour'
import { isTourId } from './tour/tours'

/**
 * The one-line tip shown the first time someone opens a screen, with the way
 * to the screen's tour and its guide pages. Closed for good with ×, or by
 * taking the tour.
 *
 * It waits for the welcome tour to have been answered (`mode: 'none'`): one
 * thing at a time, and the welcome tour is the one that explains what these
 * are. Not shown in an assumed session, where closing it could not be saved.
 */
export function ScreenHint() {
  const { t } = useTranslation()
  const location = useLocation()
  const { summary, record, canSave } = useOnboarding()
  const { active, startTour } = useTour()
  const { openHelp } = useUserHelp()

  const hint = hintForLocation(location.pathname, location.search)
  const tour = tourForLocation(location.pathname, location.search)

  if (!hint || !summary || !canSave || active) return null
  if (summary.mode !== 'none') return null
  if (summary.state.hintsDismissed?.includes(hint)) return null

  const dismiss = () => record({ hintsDismissed: [hint] })

  return (
    <Paper
      variant="outlined"
      role="note"
      sx={{
        mb: 2,
        px: 2,
        py: 1.25,
        display: 'flex',
        alignItems: { xs: 'flex-start', sm: 'center' },
        flexDirection: { xs: 'column', sm: 'row' },
        gap: { xs: 1, sm: 1.5 },
        borderColor: 'primary.main',
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
        position: 'relative',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, flex: 1, minWidth: 0, pe: { xs: 4, sm: 0 } }}>
        <LightbulbOutlinedIcon color="primary" fontSize="small" sx={{ mt: '2px' }} />
        <Typography variant="body2">{t(`onboarding.hints.${hint}`)}</Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, ms: { xs: 4, sm: 0 } }}>
        {tour && isTourId(tour) && (
          <Button
            size="small"
            startIcon={<ExploreOutlinedIcon fontSize="small" />}
            onClick={() => {
              dismiss()
              startTour(tour)
            }}
          >
            {t('onboarding.tour.showMeAround')}
          </Button>
        )}
        <Button size="small" color="inherit" startIcon={<MenuBookIcon fontSize="small" />} onClick={() => openHelp()}>
          {t('onboarding.tour.readMore')}
        </Button>
      </Box>
      <IconButton
        size="small"
        aria-label={t('onboarding.hint.dismiss')}
        onClick={dismiss}
        sx={{ position: { xs: 'absolute', sm: 'static' }, top: 6, insetInlineEnd: 6 }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Paper>
  )
}
