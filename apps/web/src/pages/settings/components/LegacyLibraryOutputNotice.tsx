import { Alert, AlertTitle, Button } from '@mui/material'
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLegacyLibraryOutput } from '@/hooks/legacyLibraryOutput'
import { adminPathFor } from '@/pages/admin/nav/registry'

/**
 * Sits above every setting that only concerns legacy library output, while
 * that output is switched off. The section greys its own controls from the
 * same hook; this is the sentence saying why, and where the switch lives.
 *
 * Deliberately NOT exported from `settings/components/index.ts`: that barrel is
 * the list of admin destinations (the registry test gives each export a home),
 * and this is a part of several destinations, not one of its own.
 */
export function LegacyLibraryOutputNotice() {
  const { t } = useTranslation()
  const { off } = useLegacyLibraryOutput()

  if (!off) return null

  return (
    <Alert
      severity="info"
      icon={<ArchiveOutlinedIcon />}
      sx={{ mb: 2 }}
      action={
        <Button color="inherit" size="small" component={RouterLink} to={adminPathFor('output-format')}>
          {t('legacyLibraryOutput.notice.action')}
        </Button>
      }
    >
      <AlertTitle>{t('legacyLibraryOutput.notice.title')}</AlertTitle>
      {t('legacyLibraryOutput.notice.body')}
    </Alert>
  )
}
