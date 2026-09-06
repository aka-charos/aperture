import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import { useTranslation } from 'react-i18next'

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
 * the same GET as the values, so the parent has to know it either way and
 * fetching it twice to make the card self-contained would be the more expensive
 * shape. The parent renders the Grid item conditionally, so a viewer without
 * the grant sees no hole in the layout rather than an empty column.
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
    <Card sx={{ backgroundColor: 'background.default', borderRadius: 2, height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <MailOutlineIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" fontWeight={600}>
            {t('userSettings.emailSectionTitle')}
          </Typography>
        </Box>

        {emailError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={onDismissEmailError}>
            {emailError}
          </Alert>
        )}

        {emailSuccess && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={onDismissSuccess}>
            {emailSuccess}
          </Alert>
        )}

        {loadingEmail ? (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <>
            <TextField
              label={t('userSettings.emailAddress')}
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              fullWidth
              margin="normal"
              size="small"
              placeholder={t('userSettings.emailPlaceholder')}
              helperText={
                emailLocked ? t('userSettings.emailHelperCustom') : t('userSettings.emailHelperSynced')
              }
              InputProps={{
                endAdornment: savingEmail ? <CircularProgress size={16} /> : null,
              }}
              onBlur={onEmailBlur}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={emailNotificationsEnabled}
                  onChange={(e) => onNotificationsChange(e.target.checked)}
                  disabled={savingEmail}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{t('userSettings.emailNotificationsTitle')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('userSettings.emailNotificationsSubtitle')}
                  </Typography>
                </Box>
              }
              sx={{ mt: 1, alignItems: 'flex-start' }}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
