import { Box, Chip, Tooltip, Typography } from '@mui/material'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import { useTranslation } from 'react-i18next'
import type { NotificationReach } from './useNotificationReach'

/**
 * One account's phones and how notifications reach it, for the App column. A
 * phone that has not checked in for longer than a sign-in lasts is shown as
 * signed out rather than guessed to be uninstalled: nothing reports an
 * uninstall, and the app checks in only while the screen is on.
 */
export function NotificationReachCell({ reach }: { reach: NotificationReach | undefined }) {
  const { t } = useTranslation()
  if (!reach) return <Typography variant="body2" color="text.secondary">—</Typography>

  const active = reach.devices.filter((device) => !device.signedOut)
  const appReady = active.some((device) => device.notificationsAllowed) && reach.appEvents.length > 0
  const emailReady = reach.email.unreachable == null && reach.emailEvents.length > 0

  const summary = (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="caption" component="div">
        {reach.email.unreachable == null
          ? t('admin.usersPage.notifyEmailEvents', { count: reach.emailEvents.length })
          : t(`admin.usersPage.notifyEmailUnreachable.${reach.email.unreachable}`)}
      </Typography>
      <Typography variant="caption" component="div">
        {reach.devices.length > 0
          ? t('admin.usersPage.notifyAppEvents', { count: reach.appEvents.length })
          : t('admin.usersPage.notifyNoPhone')}
      </Typography>
      {reach.devices.map((device) => (
        <Typography key={device.id} variant="caption" component="div" sx={{ mt: 0.5 }}>
          {[
            device.model ?? t('admin.usersPage.notifyPhone'),
            device.appVersion,
            t('admin.usersPage.notifyLastSeen', { when: new Date(device.lastSeenAt).toLocaleString() }),
            device.signedOut
              ? t('admin.usersPage.notifySignedOut')
              : device.notificationsAllowed
                ? null
                : t('admin.usersPage.notifyBlocked'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
      ))}
      {!emailReady && !appReady && (
        <Typography variant="caption" component="div" sx={{ mt: 0.5, fontWeight: 600 }}>
          {t('admin.usersPage.notifyNothing')}
        </Typography>
      )}
    </Box>
  )

  return (
    <Tooltip title={summary}>
      {reach.devices.length > 0 ? (
        <Chip
          size="small"
          icon={<PhoneAndroidIcon />}
          label={reach.devices.length}
          color={appReady ? 'success' : 'default'}
          variant={appReady ? 'filled' : 'outlined'}
        />
      ) : (
        <Typography variant="body2" color="text.secondary" component="span">
          —
        </Typography>
      )}
    </Tooltip>
  )
}
