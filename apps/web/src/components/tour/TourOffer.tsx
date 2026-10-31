import { useTranslation } from 'react-i18next'
import { Box, Button, IconButton, Typography, type SxProps, type Theme } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined'
import { Badge, IconTile } from './IconTile'

/**
 * The welcome tour's offer: what it is and the three answers. One copy for its
 * two places, the card floating over a page (`WelcomeStarter`) and the row of
 * Home's checklist, which carries it while the checklist is on screen.
 *
 * Take starts the tour, No thanks answers it for good, and × only puts it off
 * until the next sign-in.
 */
export function TourOffer({
  onTake,
  onDecline,
  onLater,
  headingComponent,
  sx,
}: {
  onTake: () => void
  onDecline: () => void
  onLater: () => void
  /** The heading's level where it sits: a floating card is its own region, a row sits under the checklist's heading. */
  headingComponent: 'h2' | 'h3'
  sx?: SxProps<Theme>
}) {
  const { t } = useTranslation()
  return (
    <Box role="region" aria-label={t('onboarding.offer.title')} sx={[{ display: 'flex', gap: 1.75 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <IconTile>
        <ExploreOutlinedIcon />
      </IconTile>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Badge>{t('onboarding.offer.badge')}</Badge>
          <Typography component={headingComponent} sx={{ fontSize: 15, fontWeight: 700 }}>
            {t('onboarding.offer.heading')}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
          {t('onboarding.offer.body')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, pt: 1.25 }}>
          <Button variant="contained" disableElevation onClick={onTake} sx={{ minHeight: 40, borderRadius: 2.5, px: 1.75, fontWeight: 600 }}>
            {t('onboarding.offer.take')}
          </Button>
          <Button color="inherit" onClick={onDecline} sx={{ minHeight: 40, color: 'text.secondary' }}>
            {t('onboarding.offer.decline')}
          </Button>
        </Box>
      </Box>
      <IconButton
        aria-label={t('onboarding.offer.later')}
        onClick={onLater}
        sx={{ alignSelf: 'flex-start', mt: -0.75, me: -0.75, color: 'text.secondary', width: 40, height: 40 }}
      >
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}
