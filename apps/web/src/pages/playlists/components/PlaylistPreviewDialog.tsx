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
  Avatar,
  Chip,
  Tooltip,
  Button,
  Alert,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import { getProxiedImageUrl } from '@aperture/ui'
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
          <Box>
            {seedCount > 0 && (
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                {pt('previewSeedNote', { count: seedCount })}
              </Typography>
            )}
            {items.map((item, index) => (
              <Box
                key={item.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  py: 1.5,
                  px: 1,
                  borderBottom: index < items.length - 1 ? 1 : 0,
                  borderColor: 'divider',
                  '&:hover': { backgroundColor: 'action.hover' },
                }}
              >
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 24 }}>
                  {index + 1}
                </Typography>
                <Avatar
                  src={getProxiedImageUrl(item.posterUrl)}
                  variant="rounded"
                  sx={{ width: 40, height: 60 }}
                >
                  {item.mediaType === 'series' ? <TvIcon /> : <MovieIcon />}
                </Avatar>
                <Box flexGrow={1} minWidth={0}>
                  <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                    <Typography variant="body1">{item.title}</Typography>
                    {item.isSeed && (
                      <Chip
                        label={pt('previewSeedBadge')}
                        size="small"
                        color="primary"
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {item.year || pt('unknownYear')}
                    {item.runtime ? ` • ${item.runtime} min` : ''}
                    {item.mediaType === 'series' ? ` • ${pt('mediaTypeSeries')}` : ''}
                  </Typography>
                </Box>
                <Tooltip title={pt('previewRemoveItem')}>
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => onRemoveItem(item.id)}
                      disabled={confirming}
                    >
                      <RemoveCircleOutlineIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
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
