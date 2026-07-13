import React from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  FormControlLabel,
  Switch,
  Button,
} from '@mui/material'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import { useTranslation } from 'react-i18next'
import { usePosterPrefs } from '@/hooks/usePosterPrefs'

/**
 * Poster display preferences: whether the community-rating badge is overlaid
 * on library posters (some servers burn a rating into the artwork itself).
 *
 * The switch reflects the effective state (explicit override, else the server
 * default an admin set). Toggling it records an explicit override; a reset
 * button returns the choice to whatever the server default is.
 */
export function PosterDisplayCard() {
  const { t } = useTranslation()
  const { hidePosterRating, userOverride, serverDefaultHide, setHidePosterRating, loading } =
    usePosterPrefs()

  const defaultStateLabel = serverDefaultHide
    ? t('userSettings.posterDisplay.stateHidden')
    : t('userSettings.posterDisplay.stateShown')

  return (
    <Card sx={{ backgroundColor: 'background.default', borderRadius: 2, height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <StarBorderIcon color="primary" />
          <Typography variant="h6">{t('userSettings.posterDisplay.title')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" mb={3}>
          {t('userSettings.posterDisplay.subtitle')}
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={!hidePosterRating}
              onChange={(e) => setHidePosterRating(!e.target.checked)}
              disabled={loading}
            />
          }
          label={t('userSettings.posterDisplay.showRatingLabel')}
        />
        <Typography variant="caption" color="text.secondary" display="block" mt={1}>
          {t('userSettings.posterDisplay.showRatingHelp')}
        </Typography>

        {userOverride !== null && (
          <Button
            variant="outlined"
            size="small"
            sx={{ mt: 2 }}
            onClick={() => setHidePosterRating(null)}
            disabled={loading}
          >
            {t('userSettings.posterDisplay.resetToDefault', { state: defaultStateLabel })}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
