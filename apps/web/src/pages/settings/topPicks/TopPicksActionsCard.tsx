import { Button, Card, CardContent, CircularProgress, Stack, Tooltip } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import RestoreIcon from '@mui/icons-material/Restore'
import SaveIcon from '@mui/icons-material/Save'
import { useTranslation } from 'react-i18next'
import { useLegacyLibraryOutput } from '@/hooks/legacyLibraryOutput'
import type { TopPicksConfig } from './types'

export interface TopPicksActionsCardProps {
  config: TopPicksConfig
  saving: boolean
  hasChanges: boolean
  handleSave: () => void | Promise<void>
  handleReset: () => void | Promise<void>
  handleRefreshNow: () => void | Promise<void>
}

export function TopPicksActionsCard({
  config,
  saving,
  hasChanges,
  handleSave,
  handleReset,
  handleRefreshNow,
}: TopPicksActionsCardProps) {
  const { t } = useTranslation()
  // Refresh Now runs refresh-top-picks, whose whole product is the legacy
  // libraries; the Top Picks pages and home rows compute their lists live.
  const { off: legacyOff } = useLegacyLibraryOutput()

  return (
    <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={2} justifyContent="space-between" alignItems="center">
          <Stack direction="row" spacing={2}>
            <Button
              variant="outlined"
              startIcon={<RestoreIcon />}
              onClick={() => void handleReset()}
              disabled={saving}
            >
              {t('topPicksAdmin.actions.resetDefaults')}
            </Button>
            <Tooltip title={legacyOff ? t('legacyLibraryOutput.jobBlocked.legacyLibraryOutputOff') : ''}>
              {/* A span, because a disabled button fires no events for the tooltip. */}
              <span>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={() => void handleRefreshNow()}
                  disabled={!config.isEnabled || legacyOff}
                >
                  {t('topPicksAdmin.actions.refreshNow')}
                </Button>
              </span>
            </Tooltip>
          </Stack>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
            onClick={() => void handleSave()}
            disabled={saving || !hasChanges}
            size="large"
          >
            {saving ? t('topPicksAdmin.actions.saving') : t('topPicksAdmin.actions.saveChanges')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
