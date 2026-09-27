import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Snackbar,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { useConnections } from '@/hooks/useConnections'
import { withServerMessageDetail } from '@/lib/withServerMessageDetail'

interface Recipient {
  id: string
  name: string
  avatarUrl: string
  alreadyWatched: boolean
  unavailable: boolean
  alreadyRecommended: boolean
}

type SkipReason = 'not_connected' | 'unavailable' | 'already_watched'

interface RecommendOutcome {
  sent: number
  skipped: Array<{ userId: string; reason: SkipReason }>
}

interface RecommendToDialogProps {
  open: boolean
  mediaType: 'movie' | 'series'
  itemId: string
  itemTitle: string
  onClose: () => void
}

const SKIP_KEYS: Record<SkipReason, string> = {
  already_watched: 'mediaDetail.recommendDialog.skippedWatched',
  unavailable: 'mediaDetail.recommendDialog.skippedUnavailable',
  not_connected: 'mediaDetail.recommendDialog.skippedDisconnected',
}

async function serverMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown }
    const text = body.error ?? body.message
    return typeof text === 'string' && text.trim() ? text : null
  } catch {
    return null
  }
}

/**
 * Recommend one title to some of the people the viewer is connected to
 * (docs/plans/social-connections.md §7.3).
 *
 * The rows' flags come from the server and the send re-checks every one of
 * them, so this is presentation only: someone who has finished the title or
 * cannot open it is shown disabled with the reason, and a client ignoring that
 * would still be refused per recipient.
 *
 * Works without a router, since the detail page also renders inside
 * MediaDetailModal. A late answer for a title the dialog is no longer open for
 * is dropped, so it can never render under another
 * title's heading.
 */
export function RecommendToDialog({ open, mediaType, itemId, itemTitle, onClose }: RecommendToDialogProps) {
  const { t } = useTranslation()
  const { refresh } = useConnections()
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<{ severity: 'success' | 'warning' | 'error'; lines: string[] } | null>(null)

  useEffect(() => {
    if (!open) return
    // Each opening (and each title) gets its own flag; a late answer for one
    // that has been closed or replaced is dropped rather than rendered.
    let current = true
    setRecipients([])
    setSelected(new Set())
    setLoadError(null)
    setLoading(true)

    const param = mediaType === 'movie' ? 'movieId' : 'seriesId'
    fetch(`/api/social/recommendations/recipients?${param}=${encodeURIComponent(itemId)}`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!current) return
        if (!response.ok) {
          const message = await serverMessage(response)
          if (!current) return
          setLoadError(
            message
              ? `${t('mediaDetail.recommendDialog.loadFailed')}: ${withServerMessageDetail(t, message)}`
              : t('mediaDetail.recommendDialog.loadFailed')
          )
          return
        }
        const data = (await response.json()) as { recipients?: Recipient[] }
        if (!current) return
        setRecipients(data.recipients ?? [])
      })
      .catch((err) => {
        console.error('Failed to load recommendation recipients:', err)
        if (current) setLoadError(t('mediaDetail.recommendDialog.loadFailed'))
      })
      .finally(() => {
        if (current) setLoading(false)
      })

    return () => {
      current = false
    }
  }, [open, mediaType, itemId, t])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const nameOf = (id: string) => recipients.find((r) => r.id === id)?.name ?? ''

  const handleSend = async () => {
    if (selected.size === 0 || sending) return
    setSending(true)
    try {
      const response = await fetch('/api/social/recommendations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(mediaType === 'movie' ? { movieId: itemId } : { seriesId: itemId }),
          recipientUserIds: [...selected],
        }),
      })
      if (!response.ok) {
        // During "view as" or with a read-only key this is the refusal text,
        // which is more useful than a generic failure.
        const message = await serverMessage(response)
        setNotice({
          severity: 'error',
          lines: [
            message
              ? `${t('mediaDetail.recommendDialog.failed')}: ${withServerMessageDetail(t, message)}`
              : t('mediaDetail.recommendDialog.failed'),
          ],
        })
        return
      }
      const outcome = (await response.json()) as RecommendOutcome
      const skippedLines = (outcome.skipped ?? []).map((s) =>
        t(SKIP_KEYS[s.reason] ?? SKIP_KEYS.not_connected, { name: nameOf(s.userId) })
      )
      if (outcome.sent > 0) {
        setNotice({
          severity: 'success',
          lines: [t('mediaDetail.recommendDialog.sent', { count: outcome.sent }), ...skippedLines],
        })
      } else {
        setNotice({ severity: 'warning', lines: skippedLines.length > 0 ? skippedLines : [t('mediaDetail.recommendDialog.failed')] })
      }
      void refresh()
      onClose()
    } catch (err) {
      console.error('Failed to send recommendation:', err)
      setNotice({ severity: 'error', lines: [t('mediaDetail.recommendDialog.failed')] })
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {t('mediaDetail.recommendDialog.title', { title: itemTitle })}
          </Box>
          <IconButton onClick={onClose} size="small" aria-label={t('common.close')}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 1.5, pb: 1 }}>
            {t('mediaDetail.recommendDialog.description')}
          </Typography>

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          )}

          {!loading && loadError && (
            <Alert severity="error" sx={{ m: 2 }}>
              {loadError}
            </Alert>
          )}

          {!loading && !loadError && recipients.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2 }}>
              {t('mediaDetail.recommendDialog.empty')}
            </Typography>
          )}

          {!loading && !loadError && recipients.length > 0 && (
            <List dense disablePadding>
              {recipients.map((r) => {
                const disabled = r.unavailable || r.alreadyWatched
                const caption = r.unavailable
                  ? t('mediaDetail.recommendDialog.unavailable')
                  : r.alreadyWatched
                    ? t('mediaDetail.recommendDialog.alreadyWatched')
                    : r.alreadyRecommended
                      ? t('mediaDetail.recommendDialog.alreadyRecommended')
                      : undefined
                const checkboxId = `recommend-to-${r.id}`
                return (
                  <ListItem key={r.id} disablePadding>
                    <ListItemButton
                      onClick={() => toggle(r.id)}
                      disabled={disabled || sending}
                      role={undefined}
                      dense
                    >
                      <ListItemAvatar sx={{ minWidth: 48 }}>
                        <Avatar src={r.avatarUrl} alt="" sx={{ width: 32, height: 32, fontSize: '0.8rem' }}>
                          {r.name.charAt(0).toUpperCase()}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText id={checkboxId} primary={r.name} secondary={caption} />
                      <Checkbox
                        edge="end"
                        checked={!disabled && selected.has(r.id)}
                        tabIndex={-1}
                        disableRipple
                        disabled={disabled}
                        inputProps={{ 'aria-labelledby': checkboxId }}
                      />
                    </ListItemButton>
                  </ListItem>
                )
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSend}
            disabled={selected.size === 0 || sending || loading}
            startIcon={sending ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t('mediaDetail.recommendDialog.send')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={notice !== null}
        autoHideDuration={6000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={notice?.severity ?? 'success'} variant="filled" onClose={() => setNotice(null)}>
          {notice?.lines.map((line, i) => (
            <Box key={i} component="span" sx={{ display: 'block' }}>
              {line}
            </Box>
          ))}
        </Alert>
      </Snackbar>
    </>
  )
}
