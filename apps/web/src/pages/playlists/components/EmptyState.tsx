import { Card, Typography, Button } from '@mui/material'
import { useTranslation } from 'react-i18next'
import AddIcon from '@mui/icons-material/Add'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'

interface EmptyStateProps {
  onCreateClick: () => void
  i18nNamespace?: string
}

export function EmptyState({ onCreateClick, i18nNamespace = 'playlists' }: EmptyStateProps) {
  const { t } = useTranslation()
  const pt = (key: string, options?: Record<string, unknown>) => t(`${i18nNamespace}.${key}`, options)
  return (
    <Card
      sx={{
        backgroundColor: 'background.paper',
        borderRadius: 2,
        textAlign: 'center',
        py: 6,
      }}
    >
      <PlaylistPlayIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
      <Typography variant="h6" mb={1}>
        {pt('emptyTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        {pt('emptyBody')}
      </Typography>
      <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateClick}>
        {pt('createPlaylist')}
      </Button>
    </Card>
  )
}



