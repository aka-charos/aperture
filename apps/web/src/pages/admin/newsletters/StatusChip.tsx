import { useTranslation } from 'react-i18next'
import { Chip } from '@mui/material'
import type { NewsletterStatus } from './api'

const COLOR: Record<NewsletterStatus, 'default' | 'info' | 'success' | 'error'> = {
  draft: 'default',
  sending: 'info',
  sent: 'success',
  failed: 'error',
}

export function StatusChip({ status }: { status: NewsletterStatus }) {
  const { t } = useTranslation()
  return <Chip size="small" color={COLOR[status]} label={t(`newsletters.status.${status}`)} />
}
