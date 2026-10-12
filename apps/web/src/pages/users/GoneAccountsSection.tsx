import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import PersonOffIcon from '@mui/icons-material/PersonOff'
import { formatRelativeTime } from '@/lib/relativeTime'
import { withServerMessageDetail } from '@/lib/withServerMessageDetail'

/**
 * Accounts Aperture still holds that the media server no longer lists. The
 * rest of the Users page is drawn from the media server's own list, so these
 * had nowhere to appear. Which accounts belong here is decided by the server
 * (core `accountsGoneFromMediaServer`); the remove route asks the media server
 * again before deleting anything.
 */

export interface GoneAccount {
  id: string
  username: string
  email: string | null
  accessEnabled: boolean
  createdAt: string
  lastLoginAt: string | null
  missingSince: string | null
  watchedTitles: number
  ratings: number
}

interface Props {
  accounts: GoneAccount[] | null
  /** The media server's name, e.g. "Emby". */
  provider: string
  onRemoved: (account: GoneAccount) => void
}

export function GoneAccountsSection({ accounts, provider, onRemoved }: Props) {
  const { t, i18n } = useTranslation()
  const [confirming, setConfirming] = useState<GoneAccount | null>(null)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!accounts || accounts.length === 0) return null

  const now = new Date()
  const when = (iso: string) => formatRelativeTime(new Date(iso), now, i18n.language)

  const close = () => {
    if (removing) return
    setConfirming(null)
    setError(null)
  }

  const remove = async () => {
    if (!confirming) return
    setRemoving(true)
    setError(null)
    try {
      const response = await fetch(`/api/users/${confirming.id}`, { method: 'DELETE', credentials: 'include' })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error ? withServerMessageDetail(t, data.error) : t('admin.usersPage.gone.removeError'))
        return
      }
      const removed = confirming
      setConfirming(null)
      onRemoved(removed)
    } catch {
      setError(t('admin.usersPage.gone.removeError'))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1.5} mb={1}>
          <PersonOffIcon color="warning" />
          <Typography variant="h6" fontWeight={600}>
            {t('admin.usersPage.gone.title', { provider, count: accounts.length })}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t('admin.usersPage.gone.description', { provider })}
        </Typography>

        <Box display="flex" flexDirection="column" gap={1}>
          {accounts.map((account) => (
            <Box
              key={account.id}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                px: 1.5,
                py: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                flexWrap: 'wrap',
              }}
            >
              <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
                  {account.username}
                </Typography>
                {account.email && (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: 'break-all' }}>
                    {account.email}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary" component="div">
                  {[
                    t('admin.usersPage.gone.created', { when: when(account.createdAt) }),
                    account.lastLoginAt
                      ? t('admin.usersPage.gone.lastSignIn', { when: when(account.lastLoginAt) })
                      : t('admin.usersPage.gone.neverSignedIn'),
                    t('admin.usersPage.gone.watched', { count: account.watchedTitles }),
                    t('admin.usersPage.gone.rated', { count: account.ratings }),
                  ].join(' · ')}
                </Typography>
              </Box>
              {account.missingSince ? (
                <Chip
                  size="small"
                  variant="outlined"
                  label={t('admin.usersPage.gone.paused', { when: when(account.missingSince) })}
                />
              ) : (
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  label={t('admin.usersPage.gone.notPausedYet')}
                />
              )}
              <Button
                size="small"
                color="error"
                variant="outlined"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => setConfirming(account)}
              >
                {t('admin.usersPage.gone.remove')}
              </Button>
            </Box>
          ))}
        </Box>
      </CardContent>

      <Dialog open={confirming !== null} onClose={close} maxWidth="xs" fullWidth>
        {confirming && (
          <>
            <DialogTitle>{t('admin.usersPage.gone.confirmTitle', { name: confirming.username })}</DialogTitle>
            <DialogContent>
              <DialogContentText>
                {t('admin.usersPage.gone.confirmBody', {
                  name: confirming.username,
                  provider,
                  watched: t('admin.usersPage.gone.watched', { count: confirming.watchedTitles }),
                  rated: t('admin.usersPage.gone.rated', { count: confirming.ratings }),
                })}
              </DialogContentText>
              {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={close} disabled={removing}>
                {t('common.cancel')}
              </Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => void remove()}
                disabled={removing}
                startIcon={removing ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineIcon />}
              >
                {t('admin.usersPage.gone.confirmRemove')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Card>
  )
}
