import { Alert, Box, Button, Switch, Typography } from '@mui/material'
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from './SettingsCard'
import type { NotificationDevice, NotificationEvent, NotificationSettings } from './hooks/useNotificationSettings'

interface NotificationsCardProps {
  settings: NotificationSettings | null
  offered: boolean
  saving: boolean
  error: boolean
  onChange: (event: NotificationEvent, channel: 'email' | 'app', value: boolean) => void
  onRemoveDevice: (id: string) => void
  onDismissError: () => void
}

/**
 * What reaches the person, and how. Email is a column for everyone the admin
 * lets receive email; the App column, and the phone list under it, appear
 * only once one of their phones has checked in, so nothing here mentions the
 * app to someone who does not have it.
 */
export function NotificationsCard({
  settings,
  offered,
  saving,
  error,
  onChange,
  onRemoveDevice,
  onDismissError,
}: NotificationsCardProps) {
  const { t, i18n } = useTranslation()
  if (!settings || !offered) return null

  const hasApp = settings.devices.length > 0
  const emailUsable = settings.email.reachable
  const columns = hasApp ? 'minmax(0, 1fr) auto auto' : 'minmax(0, 1fr) auto'

  const lastSeen = (device: NotificationDevice) =>
    new Date(device.lastSeenAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <SettingsCard
      id="notifications"
      icon={<NotificationsNoneOutlinedIcon />}
      title={t('userSettings.notifications.title')}
      description={hasApp ? t('userSettings.notifications.descriptionWithApp') : t('userSettings.notifications.description')}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={onDismissError}>
          {t('userSettings.notifications.error')}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: columns, alignItems: 'center', columnGap: 1 }}>
        <span />
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
          {t('userSettings.notifications.email')}
        </Typography>
        {hasApp && (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            {t('userSettings.notifications.app')}
          </Typography>
        )}
        {settings.preferences.map((preference) => {
          const event = preference.event
          // An event a newer server added before this bundle has words for shows under its id.
          const label = t(`userSettings.notifications.events.${event}.title`, { defaultValue: event })
          return (
            <Box key={event} sx={{ display: 'contents' }}>
              <Box sx={{ py: 0.75 }}>
                <Typography variant="body2">{label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t(`userSettings.notifications.events.${event}.description`, { defaultValue: '' })}
                </Typography>
              </Box>
              <Switch
                checked={preference.email && emailUsable}
                disabled={saving || !emailUsable}
                onChange={(e) => onChange(event, 'email', e.target.checked)}
                slotProps={{ input: { 'aria-label': `${label}: ${t('userSettings.notifications.email')}` } }}
              />
              {hasApp && (
                <Switch
                  checked={preference.app}
                  disabled={saving}
                  onChange={(e) => onChange(event, 'app', e.target.checked)}
                  slotProps={{ input: { 'aria-label': `${label}: ${t('userSettings.notifications.app')}` } }}
                />
              )}
            </Box>
          )
        })}
      </Box>

      {!emailUsable && settings.email.reason === 'noAddress' && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('userSettings.notifications.noAddress')}
        </Typography>
      )}
      {!emailUsable && settings.email.reason === 'notAllowed' && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('userSettings.notifications.emailNotAllowed')}
        </Typography>
      )}

      {hasApp && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t('userSettings.notifications.phones')}
          </Typography>
          {settings.devices.map((device) => (
            <Box
              key={device.id}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderTop: 1, borderColor: 'divider' }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {device.model ?? t('userSettings.notifications.unknownPhone')}
                  {device.appVersion ? ` · ${t('userSettings.notifications.appVersion', { version: device.appVersion })}` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {t('userSettings.notifications.lastSeen', { when: lastSeen(device) })}
                </Typography>
                {device.signedOut ? (
                  <Typography variant="caption" color="warning.main" component="div">
                    {t('userSettings.notifications.signedOut')}
                  </Typography>
                ) : (
                  !device.notificationsAllowed && (
                    <Typography variant="caption" color="warning.main" component="div">
                      {t('userSettings.notifications.blocked')}
                    </Typography>
                  )
                )}
              </Box>
              <Button size="small" color="inherit" onClick={() => onRemoveDevice(device.id)}>
                {t('userSettings.notifications.removePhone')}
              </Button>
            </Box>
          ))}
        </Box>
      )}
    </SettingsCard>
  )
}
