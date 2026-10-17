import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Button } from '@mui/material'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined'
import ReplayIcon from '@mui/icons-material/Replay'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useTour } from '@/hooks/useTour'
import { SettingsCard } from './SettingsCard'

/**
 * The tour and the first-visit tips, again: start the welcome tour now, or
 * bring back the one-line tips closed on each screen and the getting-started
 * list on Home. Nothing about recommendations moves.
 */
export function TipsCard() {
  const { t } = useTranslation()
  const { summary, record, canSave } = useOnboarding()
  const { startTour } = useTour()
  const [reset, setReset] = useState(false)

  const nothingToReset =
    !summary ||
    (!summary.state.hintsDismissed?.length && !summary.state.toursSeen?.length && !summary.state.checklistDismissed)

  return (
    <SettingsCard
      icon={<LightbulbOutlinedIcon />}
      title={t('onboarding.settings.title')}
      description={t('onboarding.settings.description')}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button size="small" variant="outlined" startIcon={<ExploreOutlinedIcon />} onClick={() => startTour('welcome')}>
          {t('onboarding.menu.takeTour')}
        </Button>
        <Button
          size="small"
          startIcon={<ReplayIcon />}
          disabled={!canSave || nothingToReset}
          onClick={() => {
            record({ resetTips: true, checklistDismissed: false })
            setReset(true)
          }}
        >
          {reset && nothingToReset ? t('onboarding.settings.resetDone') : t('onboarding.settings.reset')}
        </Button>
      </Box>
    </SettingsCard>
  )
}
