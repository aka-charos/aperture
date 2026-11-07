import { Alert, AlertTitle, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useMediaServer } from '../../../hooks/useMediaServer'

/**
 * Explains how to surface the favorited series on the media server's own home screen.
 * Emby can host a filtered "Dynamic Content" row; Jellyfin cannot, so it is pointed at
 * the Favorites tab instead. Shows nothing until the server's capabilities are known.
 */
export function HomeRowHint() {
  const { t } = useTranslation()
  const { capabilities, isConfigured } = useMediaServer()

  if (!isConfigured || !capabilities) return null

  return (
    <Alert severity="info" sx={{ mb: 3 }}>
      {capabilities.dynamicHomeRows ? (
        <>
          <AlertTitle>{t('watching.homeRowDynamicTitle')}</AlertTitle>
          <Typography variant="body2">{t('watching.homeRowDynamicBody')}</Typography>
        </>
      ) : (
        <>
          <AlertTitle>{t('watching.homeRowFavoritesTabTitle')}</AlertTitle>
          <Typography variant="body2">{t('watching.homeRowFavoritesTabBody')}</Typography>
        </>
      )}
    </Alert>
  )
}
