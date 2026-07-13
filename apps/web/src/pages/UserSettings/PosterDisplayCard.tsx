import React from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  FormControlLabel,
  Switch,
} from '@mui/material'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import { useTranslation } from 'react-i18next'
import { usePosterPrefs } from '@/hooks/usePosterPrefs'

/**
 * Poster display preferences: whether the community-rating badge is overlaid
 * on library posters (some servers burn a rating into the artwork itself).
 */
export function PosterDisplayCard() {
  const { t } = useTranslation()
  const { hidePosterRating, setHidePosterRating, loading } = usePosterPrefs()

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
      </CardContent>
    </Card>
  )
}
