import { Alert, Button } from '@mui/material'
import { useTranslation } from 'react-i18next'

const SERVER_LABELS: Record<string, string> = {
  emby: 'Emby',
  jellyfin: 'Jellyfin',
}

function mediaServerLabel(type: string): string {
  return SERVER_LABELS[type] ?? type
}

interface MediaServerTypeMismatchAlertProps {
  /** The type the admin has selected. */
  selectedType: string
  /** The type the server reported when the connection was tested. */
  detectedType: string
  /** Switches the form to the detected type. */
  onUseDetected: () => void
}

/**
 * Shown after a connection test when the server identifies itself as a different
 * product than the one selected. Warns only; it never blocks saving.
 */
export function MediaServerTypeMismatchAlert({
  selectedType,
  detectedType,
  onUseDetected,
}: MediaServerTypeMismatchAlertProps) {
  const { t } = useTranslation()
  const detected = mediaServerLabel(detectedType)

  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={onUseDetected}>
          {t('mediaServerTypeMismatch.useDetected', { detected })}
        </Button>
      }
    >
      {t('mediaServerTypeMismatch.message', {
        detected,
        selected: mediaServerLabel(selectedType),
      })}
    </Alert>
  )
}
