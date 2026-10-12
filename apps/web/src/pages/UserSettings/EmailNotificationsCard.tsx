import { Alert, CircularProgress, Switch, TextField } from '@mui/material'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingsCard } from './SettingsCard'

/**
 * Email address and notification opt-in.
 *
 * Lifted out of the Profile tab when that tab was deleted. Everything else on
 * it was a read-only echo of the account menu header -- avatar, username,
 * display name, media server, role, all disabled fields under a caption saying
 * they are synced from the media server -- but this half is the only place a
 * viewer can set their own address, so it moved rather than going with it.
 *
 * State still lives in the parent: the whole card is gated on
 * `emailNotificationsAllowed`, an admin-granted per-user flag that arrives on
 * the same GET as the values, and the parent also needs that flag to decide
 * whether the Account tab has anything on it at all.
 */
interface EmailNotificationsCardProps {
  email: string
  emailLocked: boolean
  emailNotificationsEnabled: boolean
  loadingEmail: boolean
  savingEmail: boolean
  emailSuccess: string | null
  emailError: string | null
  onEmailChange: (value: string) => void
  onEmailBlur: () => void
  onNotificationsChange: (enabled: boolean) => void
  onDismissSuccess: () => void
  onDismissEmailError: () => void
}

export function EmailNotificationsCard({
  email,
  emailLocked,
  emailNotificationsEnabled,
  loadingEmail,
  savingEmail,
  emailSuccess,
  emailError,
  onEmailChange,
  onEmailBlur,
  onNotificationsChange,
  onDismissSuccess,
  onDismissEmailError,
}: EmailNotificationsCardProps) {
  const { t } = useTranslation()

  return (
    <SettingsCard
      icon={<MailOutlineIcon />}
      title={t('userSettings.emailSectionTitle')}
      description={t('userSettings.account.emailBody')}
    >
      {emailError && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={onDismissEmailError}>
          {emailError}
        </Alert>
      )}
      {emailSuccess && (
        <Alert severity="success" sx={{ mb: 1.5 }} onClose={onDismissSuccess}>
          {emailSuccess}
        </Alert>
      )}
      {loadingEmail ? (
        <CircularProgress size={22} />
      ) : (
        <>
          <TextField
            label={t('userSettings.emailAddress')}
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            onBlur={onEmailBlur}
            fullWidth
            size="small"
            placeholder={t('userSettings.emailPlaceholder')}
            helperText={emailLocked ? t('userSettings.emailHelperCustom') : t('userSettings.emailHelperSynced')}
            InputProps={{ endAdornment: savingEmail ? <CircularProgress size={16} /> : null }}
            sx={{ mb: 1.5 }}
          />
          <SettingRow
            label={t('userSettings.emailNotificationsTitle')}
            description={t('userSettings.emailNotificationsSubtitle')}
            control={
              <Switch
                checked={emailNotificationsEnabled}
                onChange={(e) => onNotificationsChange(e.target.checked)}
                disabled={savingEmail}
                slotProps={{ input: { 'aria-label': t('userSettings.emailNotificationsTitle') } }}
              />
            }
          />
        </>
      )}
    </SettingsCard>
  )
}
