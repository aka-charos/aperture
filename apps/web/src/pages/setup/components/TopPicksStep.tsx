import {
  Box,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Switch,
  FormControlLabel,
  Card,
  CardContent,
} from '@mui/material'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import { useTranslation } from 'react-i18next'
import type { SetupWizardContext } from '../types'

interface TopPicksStepProps {
  wizard: SetupWizardContext
}

/**
 * Whether Top Picks is on — and nothing else. The library, collection and
 * playlist it used to be written as are legacy library output (F-142): a new
 * install starts without it, and an operator who wants it sets it up in
 * Admin → Top Picks. The list itself reaches viewers in the app and, on Emby,
 * as a home-screen row, neither of which needs a choice here.
 */
export function TopPicksStep({ wizard }: TopPicksStepProps) {
  const { t } = useTranslation()
  const { error, topPicks, setTopPicks, saving, goToStep, saveTopPicks } = wizard

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t('setup.topPicksStep.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        {t('setup.topPicksStep.bodyRows')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <TrendingUpIcon color={topPicks.isEnabled ? 'primary' : 'disabled'} />
            <Box>
              <Typography variant="subtitle1" fontWeight={500}>
                {t('setup.topPicksStep.enableTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('setup.topPicksStep.enableSubtitleRows')}
              </Typography>
            </Box>
          </Box>
          <FormControlLabel
            control={
              <Switch
                checked={topPicks.isEnabled}
                onChange={(_, v) => setTopPicks((c) => ({ ...c, isEnabled: v }))}
                color="primary"
              />
            }
            label=""
          />
        </CardContent>
      </Card>

      <Alert severity="info" sx={{ mb: 3, py: 0.5 }} icon={false}>
        <Typography variant="caption">
          <strong>{t('setup.topPicksStep.noteLabel')}</strong> {t('setup.topPicksStep.noteAdvanced')}
        </Typography>
      </Alert>

      <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
        <Button variant="outlined" onClick={() => goToStep('users')}>
          {t('setup.topPicksStep.back')}
        </Button>
        <Button variant="contained" onClick={() => void saveTopPicks()} disabled={saving}>
          {saving ? <CircularProgress size={20} /> : t('setup.topPicksStep.saveContinue')}
        </Button>
      </Box>
    </Box>
  )
}
