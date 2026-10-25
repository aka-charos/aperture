import { Alert, Switch, Typography } from '@mui/material'
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from './SettingsCard'
import type { NewsletterSubscription } from './hooks/useNewsletterSubscription'

interface NewsletterCardProps {
  subscription: NewsletterSubscription | null
  offered: boolean
  saving: boolean
  error: boolean
  onChange: (optedIn: boolean) => void
  onDismissError: () => void
}

/**
 * The person's own choice to receive newsletters. Off until they switch it on:
 * an admin can put someone in a send group, but only this switch subscribes
 * them.
 */
export function NewsletterCard({ subscription, offered, saving, error, onChange, onDismissError }: NewsletterCardProps) {
  const { t } = useTranslation()
  if (!subscription || !offered) return null

  return (
    <SettingsCard
      id="newsletters"
      icon={<MarkEmailReadOutlinedIcon />}
      title={t('newsletters.subscription.title')}
      description={t('newsletters.subscription.description')}
      action={
        <Switch
          checked={subscription.optedIn}
          disabled={saving}
          onChange={(event) => onChange(event.target.checked)}
          inputProps={{ 'aria-label': t('newsletters.subscription.title') }}
        />
      }
    >
      {error && (
        <Alert severity="error" onClose={onDismissError}>
          {t('newsletters.subscription.error')}
        </Alert>
      )}
      {subscription.optedIn && !subscription.hasAddress && (
        <Typography variant="body2" color="warning.main">
          {t('newsletters.subscription.noAddress')}
        </Typography>
      )}
      {subscription.optedIn && !subscription.available && (
        <Typography variant="body2" color="text.secondary">
          {t('newsletters.subscription.unavailable')}
        </Typography>
      )}
    </SettingsCard>
  )
}
