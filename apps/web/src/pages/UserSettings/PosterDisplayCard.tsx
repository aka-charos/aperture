import { Button, Switch } from '@mui/material'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import { useTranslation } from 'react-i18next'
import { usePosterPrefs } from '@/hooks/usePosterPrefs'
import { SettingsCard } from './SettingsCard'

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
  const { hidePosterRating, userOverride, serverDefaultHide, setHidePosterRating, loading } = usePosterPrefs()

  const defaultStateLabel = serverDefaultHide
    ? t('userSettings.posterDisplay.stateHidden')
    : t('userSettings.posterDisplay.stateShown')

  return (
    <SettingsCard
      icon={<StarBorderIcon />}
      title={t('userSettings.posterDisplay.showRatingLabel')}
      description={t('userSettings.posterDisplay.showRatingHelp')}
      action={
        <Switch
          checked={!hidePosterRating}
          onChange={(e) => setHidePosterRating(!e.target.checked)}
          disabled={loading}
          slotProps={{ input: { 'aria-label': t('userSettings.posterDisplay.showRatingLabel') } }}
        />
      }
    >
      {userOverride !== null && (
        <Button
          variant="text"
          size="small"
          onClick={() => setHidePosterRating(null)}
          disabled={loading}
          sx={{ textTransform: 'none' }}
        >
          {t('userSettings.posterDisplay.resetToDefault', { state: defaultStateLabel })}
        </Button>
      )}
    </SettingsCard>
  )
}
