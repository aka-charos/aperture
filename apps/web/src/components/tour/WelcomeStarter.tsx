import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { alpha, Box, Button, IconButton, Paper, Slide, Typography, useTheme } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useTour } from '@/hooks/useTour'
import { Badge, IconTile } from './IconTile'

/** Long enough for the first screen to draw, so the tour does not land on a blank page. */
const START_DELAY_MS = 900
/** How often a tour held back by an open dialog looks again. */
const DIALOG_RECHECK_MS = 1000

/**
 * Another dialog, drawer or menu is showing. MUI marks a closed modal that
 * stays mounted (the phone's sidebar, the guide drawer) `MuiModal-hidden`, so
 * only the ones actually open count. The tour waits for them: one thing at a
 * time, and its spotlight would otherwise point at things a dialog covers.
 */
function anotherDialogIsOpen(): boolean {
  return document.querySelector('.MuiModal-root:not(.MuiModal-hidden)') !== null
}

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
  const theme = useTheme()
  const { pathname } = useLocation()
  const { summary, record, canSave, offerSnoozed, snoozeOffer, checklistShown } = useOnboarding()
  const { active, startTour } = useTour()
  const started = useRef(false)
  const [offerHidden, setOfferHidden] = useState(false)

  const mode = canSave ? summary?.mode : undefined
  const quiet = isQuietPath(pathname)

  useEffect(() => {
    if (mode !== 'tour' || started.current || quiet) return
    let timer: ReturnType<typeof setTimeout>
    const attempt = (delay: number) => {
      timer = setTimeout(() => {
        if (anotherDialogIsOpen()) {
          attempt(DIALOG_RECHECK_MS)
          return
        }
        started.current = true
        startTour('welcome')
      }, delay)
    }
    attempt(START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [mode, quiet, startTour])

  // While Home's checklist is on screen the offer is one of its rows; floating
  // here as well, it covered the checklist on a phone.
  const showOffer = mode === 'offer' && !active && !offerHidden && !offerSnoozed && !quiet && !checklistShown

  return (
    <Slide direction="up" in={showOffer} mountOnEnter unmountOnExit>
      <Paper
        role="region"
        aria-label={t('onboarding.offer.title')}
        sx={{
          position: 'fixed',
          // Clear of the assistant's floating button, bottom inline-end.
          insetInlineStart: { xs: 16, md: 'auto' },
          insetInlineEnd: { xs: 16, md: 88 },
          bottom: { xs: 84, md: 16 },
          zIndex: theme.zIndex.snackbar,
          width: { md: 380 },
          borderRadius: 4,
          overflow: 'hidden',
          backgroundImage: 'none',
          border: 1,
          borderColor: alpha(theme.palette.text.primary, 0.1),
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        }}
      >
        <Box aria-hidden="true" sx={{ height: 6, bgcolor: 'primary.main' }} />
        <Box sx={{ p: 2.25, display: 'flex', gap: 1.75 }}>
          <IconTile>
            <ExploreOutlinedIcon />
          </IconTile>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Badge>{t('onboarding.offer.badge')}</Badge>
              <Typography component="h2" sx={{ fontSize: 15, fontWeight: 700 }}>
                {t('onboarding.offer.heading')}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              {t('onboarding.offer.body')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, pt: 1.25 }}>
              <Button
                variant="contained"
                disableElevation
                onClick={() => {
                  setOfferHidden(true)
                  startTour('welcome')
                }}
                sx={{ minHeight: 40, borderRadius: 2.5, px: 1.75, fontWeight: 600 }}
              >
                {t('onboarding.offer.take')}
              </Button>
              <Button
                color="inherit"
                onClick={() => {
                  setOfferHidden(true)
                  record({ welcome: 'dismissed' })
                }}
                sx={{ minHeight: 40, color: 'text.secondary' }}
              >
                {t('onboarding.offer.decline')}
              </Button>
            </Box>
          </Box>
          {/* Closing for now is not an answer: the offer comes back at the next
              sign-in, and the tips are free to show meanwhile. */}
          <IconButton
            aria-label={t('onboarding.offer.later')}
            onClick={snoozeOffer}
            sx={{ alignSelf: 'flex-start', mt: -0.75, me: -0.75, color: 'text.secondary', width: 40, height: 40 }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      </Paper>
    </Slide>
  )
}
