import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  IconButton,
  CircularProgress,
  Button,
  Alert,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import { PreviewItemCard } from './PreviewItemCard'
import type { Channel, PreviewItem } from '../types'

interface PlaylistPreviewDialogProps {
  channel: Channel | null
  items: PreviewItem[]
  loading: boolean
  error: string | null
  confirming: boolean
  onClose: () => void
  onRemoveItem: (itemId: string) => void
  onConfirm: () => void
  i18nNamespace?: string
}

/**
 * The list a generate *would* write, shown before anything reaches the media server.
 *
 * Items can be dropped here; confirming writes exactly what is left, in this order (the generate
 * call takes the approved ids rather than re-sampling, so the result matches what was on screen).
 */
export function PlaylistPreviewDialog({
  channel,
  items,
  loading,
  error,
  confirming,
  onClose,
  onRemoveItem,
  onConfirm,
  i18nNamespace = 'playlists',
}: PlaylistPreviewDialogProps) {
  const { t } = useTranslation()
  const pt = (key: string, options?: Record<string, unknown>) => t(`${i18nNamespace}.${key}`, options)

  const seedCount = items.filter((item) => item.isSeed).length

  return (
    <Dialog open={!!channel} onClose={confirming ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h6">
              {channel?.name ? pt('previewTitle', { name: channel.name }) : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {loading
                ? pt('previewBuilding')
                : pt('previewSubtitle', { count: items.length })}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small" disabled={confirming}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {error ? (
          <Alert severity="error">{error}</Alert>
        ) : loading ? (
          <Box display="flex" flexDirection="column" alignItems="center" gap={2} py={6}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              {pt('previewBuildingHint')}
            </Typography>
          </Box>
        ) : items.length === 0 ? (
          <Box textAlign="center" py={4}>
            <Typography variant="body1" color="text.secondary">
              {pt('previewEmpty')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {pt('previewEmptyHint')}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {seedCount > 0 && (
              <Typography variant="caption" color="text.secondary" display="block">
                {pt('previewSeedNote', { count: seedCount })}
              </Typography>
            )}
            {items.map((item, index) => (
              <PreviewItemCard
                key={item.id}
                item={item}
                rank={index + 1}
                onRemove={onRemoveItem}
                removeDisabled={confirming}
                pt={pt}
              />
            ))}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={confirming} color="inherit">
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={loading || confirming || items.length === 0}
          startIcon={
            confirming ? <CircularProgress size={16} color="inherit" /> : <PlaylistAddCheckIcon />
          }
        >
          {confirming ? pt('previewConfirming') : pt('previewConfirm', { count: items.length })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
