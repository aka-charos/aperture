import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Box, Button, IconButton, Paper, Slide, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useTour } from './useTour'

/** Long enough for the first screen to draw, so the tour does not land on a blank page. */
const START_DELAY_MS = 900

/** Screens the welcome tour never starts on: it points at chrome they do not have. */
function isQuietPath(pathname: string): boolean {
  return pathname.startsWith('/admin') || pathname === '/help' || pathname.startsWith('/help/')
}

/**
 * Starts the welcome tour by itself for a new account, and offers it once to
 * an existing one — the server decides which (`mode`). Neither happens in an
 * assumed session: an admin viewing as someone is there to see their screen,
 * and nothing they did would be saved anyway.
 */
export function WelcomeStarter() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { summary, record, canSave } = useOnboarding()
  const { active, startTour } = useTour()
  const started = useRef(false)
  const [offerHidden, setOfferHidden] = useState(false)

  const mode = canSave ? summary?.mode : undefined
  const quiet = isQuietPath(pathname)

  useEffect(() => {
    if (mode !== 'tour' || started.current || quiet) return
    const timer = setTimeout(() => {
      started.current = true
      startTour('welcome')
    }, START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [mode, quiet, startTour])

  const showOffer = mode === 'offer' && !active && !offerHidden && !quiet

  return (
    <Slide direction="up" in={showOffer} mountOnEnter unmountOnExit>
      <Paper
        role="region"
        aria-label={t('onboarding.offer.title')}
        elevation={8}
        sx={{
          position: 'fixed',
          // Clear of the assistant's floating button, bottom inline-end.
          insetInlineStart: { xs: 16, md: 'auto' },
          insetInlineEnd: { xs: 16, md: 88 },
          bottom: { xs: 84, md: 16 },
          zIndex: (theme) => theme.zIndex.snackbar,
          maxWidth: { md: 380 },
          p: 2,
          borderRadius: 2,
          border: 1,
          borderColor: 'divider',
          display: 'flex',
          gap: 1.5,
        }}
      >
        <ExploreOutlinedIcon color="primary" sx={{ mt: 0.25 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            {t('onboarding.offer.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {t('onboarding.offer.body')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                setOfferHidden(true)
                startTour('welcome')
              }}
            >
              {t('onboarding.offer.take')}
            </Button>
            <Button
              size="small"
              color="inherit"
              onClick={() => {
                setOfferHidden(true)
                record({ welcome: 'dismissed' })
              }}
            >
              {t('onboarding.offer.decline')}
            </Button>
          </Box>
        </Box>
        {/* Closing for now is not an answer: the offer comes back next time. */}
        <IconButton
          size="small"
          aria-label={t('onboarding.offer.later')}
          onClick={() => setOfferHidden(true)}
          sx={{ alignSelf: 'flex-start', mt: -0.5, me: -0.5 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Paper>
    </Slide>
  )
}
