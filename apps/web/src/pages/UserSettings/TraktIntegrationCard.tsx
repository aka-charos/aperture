import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from './SettingsCard'
import type { TraktMessage, TraktStatus } from './hooks/useTraktIntegration'

interface TraktIntegrationCardProps {
  status: TraktStatus | null
  loading: boolean
  syncing: boolean
  message: TraktMessage | null
  onDismissMessage: () => void
  onConnect: () => void
  onDisconnect: () => void
  onSync: () => void
}

export function TraktIntegrationCard({
  status,
  loading,
  syncing,
  message,
  onDismissMessage,
  onConnect,
  onDisconnect,
  onSync,
}: TraktIntegrationCardProps) {
  const { t } = useTranslation()
  const theme = useTheme()

  if (!status?.traktConfigured) {
    return null
  }

  return (
    <SettingsCard
      icon={
        <Box
          component="img"
          src="/trakt.svg"
          alt=""
          sx={{
            width: 22,
            height: 22,
            // The logo ships white-on-red; drawn as a silhouette it takes the icon colour of the theme.
            filter: theme.palette.mode === 'dark' ? 'brightness(0) invert(1)' : 'brightness(0)',
          }}
        />
      }
      title={t('userSettings.traktTitle')}
      description={t('userSettings.traktSubtitle')}
      action={
        !loading && !status.connected ? (
          <Button
            variant="contained"
            size="small"
            onClick={onConnect}
            sx={{ bgcolor: '#ed1c24', '&:hover': { bgcolor: '#c9171d' } }}
          >
            {t('userSettings.traktConnect')}
          </Button>
        ) : undefined
      }
      footer={t('userSettings.traktFooter')}
    >
      {(message || loading || status.connected) && (
        <>
          {message && (
            <Alert severity={message.type} sx={{ mb: 1.5 }} onClose={onDismissMessage}>
              {message.text}
            </Alert>
          )}
          {loading ? (
            <CircularProgress size={22} />
          ) : (
            status.connected && (
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
                <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={500}>
                    {t('userSettings.traktConnectedAs', { username: status.username ?? '' })}
                  </Typography>
                  {status.syncedAt && (
                    <Typography variant="caption" color="text.secondary">
                      {t('userSettings.traktLastSynced', { when: new Date(status.syncedAt).toLocaleString() })}
                    </Typography>
                  )}
                </Box>
                <Button variant="outlined" size="small" onClick={onSync} disabled={syncing} startIcon={syncing ? <CircularProgress size={14} /> : undefined}>
                  {syncing ? t('userSettings.traktSyncing') : t('userSettings.traktSyncRatings')}
                </Button>
                <Button variant="text" color="error" size="small" onClick={onDisconnect}>
                  {t('userSettings.traktDisconnect')}
                </Button>
              </Box>
            )
          )}
        </>
      )}
    </SettingsCard>
  )
}
