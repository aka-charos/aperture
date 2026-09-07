import { useTranslation } from 'react-i18next'
import {
  Avatar,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import FavoriteIcon from '@mui/icons-material/Favorite'
import type { Watcher } from '../types'

interface WatcherListDialogProps {
  open: boolean
  title: string
  watchers: Watcher[]
  onClose: () => void
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Who watched a title, by name.
 *
 * Opened from a counter in the community strip. The strip itself stays
 * anonymous — this is the drill-in, and it only ever renders rows the server
 * chose to send, which today means an admin is looking.
 *
 * A dialog rather than only a tooltip because this page renders on phones and
 * inside MediaDetailModal, where a hover target is not reachable; the tooltip
 * is the desktop shortcut and this is the answer everywhere.
 */
export function WatcherListDialog({ open, title, watchers, onClose }: WatcherListDialogProps) {
  const { t, i18n } = useTranslation()

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1 }}>{title}</Box>
        <IconButton onClick={onClose} size="small" aria-label={t('common.close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <List dense disablePadding>
          {watchers.map((w) => {
            const details: string[] = []
            if (w.episodesWatched != null) {
              details.push(t('mediaDetail.infoCard.watcherEpisodes', { count: w.episodesWatched }))
            }
            if (w.playCount > 0) {
              details.push(t('mediaDetail.infoCard.watcherPlays', { count: w.playCount }))
            }
            if (w.lastWatched) {
              details.push(
                t('mediaDetail.infoCard.watcherLastWatched', {
                  date: new Date(w.lastWatched).toLocaleDateString(i18n.language),
                })
              )
            }
            return (
              <ListItem key={w.userId} secondaryAction={
                w.favorite ? (
                  <FavoriteIcon
                    sx={{ fontSize: 16, color: 'error.main' }}
                    aria-label={t('mediaDetail.infoCard.favorited')}
                  />
                ) : undefined
              }>
                <ListItemAvatar>
                  <Avatar sx={{ width: 32, height: 32, fontSize: '0.8rem' }}>
                    {initials(w.name)}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText primary={w.name} secondary={details.join(' · ') || undefined} />
              </ListItem>
            )
          })}
        </List>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', px: 2, py: 1.5 }}
        >
          {t('mediaDetail.infoCard.watchersAdminOnly')}
        </Typography>
      </DialogContent>
    </Dialog>
  )
}
