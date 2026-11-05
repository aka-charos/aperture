import { Alert, AlertTitle, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useMediaServer } from '../../../hooks/useMediaServer'

/**
 * Explains how to surface the favorited series on the media server's own home screen.
 * Emby can host a filtered "Dynamic Content" row; Jellyfin cannot, so it is pointed at
 * the Favorites tab instead.
 */
export function HomeRowHint() {
  const { t } = useTranslation()
  const { capabilities, isConfigured } = useMediaServer()

  if (!isConfigured) return null

  const key = capabilities.dynamicHomeRows ? 'homeRowDynamic' : 'homeRowFavoritesTab'

  return (
    <Alert severity="info" sx={{ mb: 3 }}>
      <AlertTitle>{t(`watching.${key}Title`)}</AlertTitle>
      <Typography variant="body2">{t(`watching.${key}Body`)}</Typography>
    </Alert>
  )
}
